import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

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
  constructor(private prisma: PrismaService) {}

  /**
   * Tạo DEVICE_APPROVAL token, TTL cấu hình qua env (mặc định 15 phút)
   * Trả về token plaintext (id.opaque) để gửi email/hiển thị link cho user.
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

    // TODO: gửi email/SMS… tại đây (best-effort). Ví dụ:
    // await this.mailer.send(user.email, 'Approve new device', `Click: ${frontendURL}/approve?token=${token}`)

    return { token, expiresAt };
  }

  /**
   * Approve thiết bị bằng token plaintext (id.opaque).
   * - Xác thực hash, hạn, usedAt
   * - Đặt session.approved = true
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

    await this.prisma.$transaction([
      this.prisma.userToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.userSession.update({
        where: { id: sessionId },
        data: { approved: true },
      }),
    ]);

    return { ok: true, sessionId };
  }
}
