import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { authenticator } from 'otplib';
import * as bcrypt from 'bcrypt';
import * as QRCode from 'qrcode';
import { randomBytes, randomInt } from 'node:crypto';
import { MFA_CONFIG } from './mfa.constants';
import { AuditLogService } from '../audit/audit-log.service';
// chỉnh lại path nếu khác dự án của bạn
import { TokenStateService } from '../auth/token-state.service';

@Injectable()
export class MfaService {
  constructor(
    private prisma: PrismaService,
    private auditLogger: AuditLogService,
    private tokenState: TokenStateService,
  ) {
    authenticator.options = {
      window: MFA_CONFIG.TOTP.WINDOW,
      step: MFA_CONFIG.TOTP.STEP,
    };
  }

  async hasMfaEnabled(userId: string) {
    const rec = await this.prisma.userMfa.findUnique({ where: { userId } });
    return !!rec?.enabled;
  }

  async startTotpEnroll(
    userId: string,
    issuer = MFA_CONFIG.TOTP.ISSUER,
    label?: string,
  ) {
    const existing = await this.prisma.userMfa.findUnique({
      where: { userId },
    });
    if (existing?.enabled) {
      throw new BadRequestException('MFA already enabled');
    }

    const secret = authenticator.generateSecret();
    const name = label || userId;
    const otpauth = authenticator.keyuri(name, issuer, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);

    await this.prisma.userMfa.upsert({
      where: { userId },
      update: {
        totpSecret: secret,
        enabled: false,
        verifiedAt: null,
        verifyAttempts: 0,
        lastVerifyAt: null,
      },
      create: {
        userId,
        totpSecret: secret,
        enabled: false,
      },
    });

    await this.auditLogger.log({
      action: 'MFA_TOTP_ENROLL_STARTED',
      actorId: userId,
      entity: 'mfa',
    });

    return { secret, otpauth, qrDataUrl };
  }

  async verifyTotpAndEnable(userId: string, code: string) {
    const rec = await this.prisma.userMfa.findUnique({ where: { userId } });
    if (!rec) {
      throw new BadRequestException('TOTP not initiated');
    }

    await this.checkRateLimit(userId);

    const ok = authenticator.check(code, rec.totpSecret);
    if (!ok) {
      await this.incrementAttempts(userId);
      await this.auditLogger.log({
        action: 'MFA_TOTP_VERIFY_FAILED',
        actorId: userId,
        entity: 'mfa',
      });
      throw new UnauthorizedException('Invalid TOTP');
    }

    await this.prisma.userMfa.update({
      where: { userId },
      data: {
        enabled: true,
        verifiedAt: new Date(),
        verifyAttempts: 0,
        lastVerifyAt: new Date(),
      },
    });

    // bump av để đá AT cũ (an toàn sau thay đổi MFA)
    await this.tokenState.bumpAccessVersion(userId);

    await this.auditLogger.log({
      action: 'MFA_TOTP_ENABLED',
      actorId: userId,
      entity: 'mfa',
    });

    return { enabled: true };
  }

  async verifyTotp(userId: string, code: string) {
    const rec = await this.prisma.userMfa.findUnique({ where: { userId } });
    if (!rec?.enabled) {
      throw new BadRequestException('MFA not enabled');
    }

    await this.checkRateLimit(userId);

    const ok = authenticator.check(code, rec.totpSecret);
    if (!ok) {
      await this.incrementAttempts(userId);
      await this.auditLogger.log({
        action: 'MFA_TOTP_VERIFY_FAILED',
        actorId: userId,
        entity: 'mfa',
      });
      throw new UnauthorizedException('Invalid TOTP');
    }

    // Reset attempts on successful verification
    await this.prisma.userMfa.update({
      where: { userId },
      data: {
        verifyAttempts: 0,
        lastVerifyAt: new Date(),
      },
    });

    return { ok: true };
  }

  // Helper methods for rate limiting
  private async checkRateLimit(userId: string) {
    const mfa = await this.prisma.userMfa.findUnique({
      where: { userId },
      select: { verifyAttempts: true, lastVerifyAt: true },
    });

    const attempts = mfa?.verifyAttempts ?? 0;
    if (attempts >= MFA_CONFIG.MAX_VERIFY_ATTEMPTS) {
      const lastAttempt = mfa?.lastVerifyAt || new Date();
      const timeoutEnd = new Date(
        lastAttempt.getTime() + MFA_CONFIG.VERIFY_TIMEOUT_SEC * 1000,
      );

      if (new Date() < timeoutEnd) {
        throw new UnauthorizedException(
          `Too many attempts. Please try again after ${timeoutEnd.toISOString()}`,
        );
      }

      // Reset attempts if timeout has passed
      await this.prisma.userMfa.update({
        where: { userId },
        data: { verifyAttempts: 0 },
      });
    }
  }

  private async incrementAttempts(userId: string) {
    await this.prisma.userMfa.update({
      where: { userId },
      data: {
        verifyAttempts: { increment: 1 },
        lastVerifyAt: new Date(),
      },
    });
  }

  async generateRecoveryKey(userId: string) {
    const has = await this.hasMfaEnabled(userId);
    if (!has) {
      throw new BadRequestException('MFA must be enabled first');
    }

    // Recovery key crypto-safe
    const key = randomBytes(MFA_CONFIG.RECOVERY_KEY_LENGTH).toString('hex');
    const keyHash = await bcrypt.hash(key, MFA_CONFIG.BCRYPT_ROUNDS);

    await this.prisma.userMfa.update({
      where: { userId },
      data: {
        recoveryKeyHash: keyHash,
        recoveryKeyUsedAt: null,
      },
    });

    await this.auditLogger.log({
      action: 'MFA_RECOVERY_KEY_GENERATED',
      actorId: userId,
      entity: 'mfa',
    });

    // CHỈ trả về một lần - FE hiển thị để user lưu
    return { recoveryKey: key };
  }

  async disableMfaWithRecovery(userId: string, recoveryKey: string) {
    const rec = await this.prisma.userMfa.findUnique({
      where: { userId },
    });

    if (!rec?.enabled) {
      throw new BadRequestException('MFA not enabled');
    }

    if (!rec.recoveryKeyHash) {
      throw new BadRequestException('No recovery key set');
    }

    if (rec.recoveryKeyUsedAt) {
      throw new BadRequestException('Recovery key already used');
    }

    const valid = await bcrypt.compare(recoveryKey, rec.recoveryKeyHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid recovery key');
    }

    await this.prisma.$transaction([
      // Disable MFA
      this.prisma.userMfa.update({
        where: { userId },
        data: {
          enabled: false,
          verifiedAt: null,
          recoveryKeyUsedAt: new Date(),
        },
      }),
      // Delete backup codes
      this.prisma.backupCode.deleteMany({
        where: { userId },
      }),
    ]);

    // đá AT cũ
    await this.tokenState.bumpAccessVersion(userId);

    await this.auditLogger.log({
      action: 'MFA_DISABLED_WITH_RECOVERY',
      actorId: userId,
      entity: 'mfa',
    });

    return { disabled: true };
  }

  // Tắt MFA (yêu cầu TOTP hoặc backup code)
  async disableTotp(userId: string, code?: string, backupCode?: string) {
    const rec = await this.prisma.userMfa.findUnique({ where: { userId } });
    if (!rec?.enabled) throw new BadRequestException('MFA not enabled');

    let passed = false;
    if (code) {
      passed = authenticator.check(code, rec.totpSecret);
    }
    if (!passed && backupCode) {
      passed = await this.consumeBackupCode(userId, backupCode)
        .then(() => true)
        .catch(() => false);
    }
    if (!passed) throw new UnauthorizedException('Verification required');

    await this.prisma.$transaction([
      this.prisma.userMfa.update({
        where: { userId },
        data: { enabled: false, verifiedAt: null },
      }),
      this.prisma.backupCode.deleteMany({ where: { userId } }),
    ]);

    // đá AT cũ
    await this.tokenState.bumpAccessVersion(userId);

    await this.auditLogger.log({
      action: 'MFA_DISABLED',
      actorId: userId,
      entity: 'mfa',
      meta: { method: code ? 'totp' : 'backup' },
    });
    return { disabled: true };
  }

  // Backup codes
  async generateBackupCodes(
    userId: string,
    count = MFA_CONFIG.BACKUP_CODE_COUNT,
  ) {
    const has = await this.hasMfaEnabled(userId);
    if (!has) throw new BadRequestException('Enable MFA first');

    // huỷ code cũ
    await this.prisma.backupCode.deleteMany({ where: { userId } });

    const plain: string[] = [];
    const rows: { userId: string; codeHash: string }[] = [];
    for (let i = 0; i < count; i++) {
      const code = this.randCode(MFA_CONFIG.BACKUP_CODE_LENGTH);
      const hash = await bcrypt.hash(code, MFA_CONFIG.BCRYPT_ROUNDS);
      plain.push(code);
      rows.push({ userId, codeHash: hash });
    }
    await this.prisma.backupCode.createMany({ data: rows });

    return { codes: plain }; // CHỈ trả lần đầu – FE hiển thị để user lưu
  }

  async consumeBackupCode(userId: string, code: string) {
    const list = await this.prisma.backupCode.findMany({
      where: { userId, usedAt: null },
      select: { id: true, codeHash: true },
    });

    for (const r of list) {
      const ok = await bcrypt.compare(code, r.codeHash);
      if (!ok) continue;

      // CAS: chỉ đánh dấu usedAt nếu vẫn còn null (tránh double-use)
      const res = await this.prisma.backupCode.updateMany({
        where: { id: r.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      if (res.count === 1) {
        return { ok: true, consumedId: r.id };
      }
      // nếu vừa bị ai đó "ăn" trước, thử cái tiếp theo
    }

    throw new UnauthorizedException('Invalid backup code');
  }

  // Helpers
  private randCode(len = 10) {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < len; i++) s += abc[randomInt(0, abc.length)];
    return s;
  }
}
