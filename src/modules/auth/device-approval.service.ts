import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { MailerService } from '../mailer/mailer.service';

const API_ORIGIN = process.env.API_ORIGIN || 'http://localhost:3000';

function genOpaque(len = 32) {
  return randomBytes(len).toString('base64url'); // không log chuỗi này
}
function splitApprovalToken(t: string): { id: string; opaque: string } | null {
  const i = t.indexOf('.');
  if (i <= 0) return null;
  return { id: t.slice(0, i), opaque: t.slice(i + 1) };
}
export function buildApprovalToken(id: string, opaque: string) {
  return `${id}.${opaque}`;
}

@Injectable()
export class DeviceApprovalService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
  ) {}

  /**
   * Tạo DEVICE_APPROVAL token, TTL cấu hình qua env (mặc định 15 phút)
   * Gửi email magic link qua SendGrid (one-click).
   */
  async issue(
    userId: string,
    sessionId: string,
    ctx?: { ip?: string; ua?: string; fp?: string },
  ) {
    const ttlSec = Number(process.env.DEVICE_APPROVAL_TTL_SEC || 900);
    const opaque = genOpaque(32);
    const hash = await bcrypt.hash(opaque, 10);

    const id = uuidv4();
    const expiresAt = new Date(Date.now() + ttlSec * 1000);

    await this.prisma.userToken.create({
      data: {
        id,
        userId,
        type: 'DEVICE_APPROVAL',
        tokenHash: hash,
        expiresAt,
        meta: {
          sessionId,
          ip: ctx?.ip,
          ua: ctx?.ua,
          fp: ctx?.fp,
        },
      },
    });

    const token = buildApprovalToken(id, opaque);
    const approveUrl = `${API_ORIGIN}/auth/approve-device?token=${encodeURIComponent(
      token,
    )}`;

    // Lấy email user để gửi
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    // Gửi email (best-effort, không throw nếu thiếu email)
    if (user?.email) {
      const subject = 'Approve new device';
      const html = this.renderApproveEmail({
        approveUrl,
        ip: ctx?.ip,
        ua: ctx?.ua,
        ttlMin: Math.max(1, Math.round(ttlSec / 60)),
      });

      try {
        console.log(
          `[DeviceApproval] Send email to ${user.email} for userId=${userId}, sessionId=${sessionId}`,
        );

        await this.mailer.send({
          to: user.email,
          subject,
          html,
          category: 'device_approval',
          customArgs: { userId, sessionId },
        });
      } catch (err) {
        // không bể flow refresh: email có thể gửi lại sau
        // Ghi log để biết vì sao không gửi được
        if (process.env.NODE_ENV !== 'production') {
          console.error(
            '[DEV] SendGrid error:',
            err?.response?.body || err?.message || err,
          );
          console.log('[DEV] APPROVE URL (use this manually):', approveUrl);
        }
      }
    }

    return { token, expiresAt, approveUrl }; // token trả về chỉ để debug nội bộ
  }

  private renderApproveEmail(args: {
    approveUrl: string;
    ip?: string;
    ua?: string;
    ttlMin: number;
  }) {
    const { approveUrl, ip, ua, ttlMin } = args;
    // Không nhúng token trực tiếp ngoài link; không thêm tracking
    return `
<!doctype html>
<html>
  <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5; color:#111">
    <h2>Confirm new device</h2>
    <p>We detected a sign-in attempt from a new device for your account.</p>
    <ul>
      ${ip ? `<li><b>IP:</b> ${this.escape(ip)}</li>` : ''}
      ${ua ? `<li><b>User-Agent:</b> ${this.escape(ua)}</li>` : ''}
    </ul>
    <p>This link will expire in <b>${ttlMin} minute${ttlMin > 1 ? 's' : ''}</b>.</p>
    <p>
      <a href="${approveUrl}"
         style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">
        Approve this device
      </a>
    </p>
    <p>If you didn’t request this, you can ignore this email.</p>
  </body>
</html>`.trim();
  }

  private escape(s: string) {
    return s.replace(
      /[&<>"']/g,
      (c) =>
        (
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          }) as any
        )[c],
    );
  }

  /**
   * Approve thiết bị bằng token plaintext (id.opaque).
   * - Xác thực hash, hạn, usedAt
   * - Đặt session.approved = true với điều kiện: thuộc đúng user, chưa revoke, chưa hết hạn
   * - (Khuyến nghị) Cập nhật baseline UA/FP từ meta
   */
  async approve(token: string) {
    const parts = splitApprovalToken(token);
    if (!parts) throw new BadRequestException('Malformed token');

    const row = await this.prisma.userToken.findUnique({
      where: { id: parts.id },
    });
    if (!row || row.type !== 'DEVICE_APPROVAL') {
      throw new BadRequestException('Invalid token');
    }
    if (row.usedAt) throw new BadRequestException('Token already used');
    if (row.expiresAt <= new Date())
      throw new BadRequestException('Token expired');

    const ok = await bcrypt.compare(parts.opaque, row.tokenHash);
    if (!ok) throw new UnauthorizedException('Invalid token');

    const sessionId = (row.meta as any)?.sessionId as string | undefined;
    if (!sessionId) throw new BadRequestException('Token missing session');
    if (!row.userId) throw new BadRequestException('Token missing userId');

    const meta = (row.meta as any) || {};
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userSession.updateMany({
        where: {
          id: sessionId,
          userId: row.userId!,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          approved: true,
          // cập nhật baseline để refresh sau mượt hơn
          userAgent: meta.ua ?? undefined,
          deviceFp: meta.fp ?? undefined,
        },
      });
      if (updated.count !== 1) {
        throw new BadRequestException('Session invalid');
      }
      await tx.userToken.update({
        where: { id: row.id },
        data: { usedAt: now },
      });
    });

    return { ok: true, sessionId };
  }
}
