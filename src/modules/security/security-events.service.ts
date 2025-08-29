// src/security/security-events.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

// Bắt theo enum trong Prisma schema của bạn
export type SecurityEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'TOKEN_REVOKE'
  | 'REFRESH_REUSE';

export type NetCtx = { ip?: string; ua?: string };

export type SecurityEventInput = {
  type: SecurityEventType;
  userId?: string | null; // nullable cho LOGIN_FAILED chưa định danh
  sessionId?: string | null;
  ctx?: NetCtx;
  meta?: Record<string, any>;
};

@Injectable()
export class SecurityEventsService {
  private readonly log = new Logger('SecurityEvents');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ghi sự kiện thô – dùng trực tiếp hoặc qua helpers bên dưới.
   * Bắt lỗi best-effort: không làm hỏng luồng auth nếu log lỗi.
   */
  async logEvent(input: SecurityEventInput) {
    try {
      await this.prisma.securityEvent.create({
        data: {
          type: input.type as any, // Prisma enum
          userId: input.userId ?? null,
          sessionId: input.sessionId ?? null,
          ip: input.ctx?.ip,
          userAgent: input.ctx?.ua,
          meta: input.meta ?? undefined,
        },
      });
    } catch (e: any) {
      this.log.warn('Failed to write SecurityEvent: ' + e?.message);
    }
  }

  // ---------- Helper methods (để code auth ngắn gọn) ----------

  async loginSuccess(
    userId: string,
    sessionId?: string,
    ctx?: NetCtx,
    meta?: Record<string, any>,
  ) {
    return this.logEvent({
      type: 'LOGIN_SUCCESS',
      userId,
      sessionId,
      ctx,
      meta,
    });
  }

  async loginFailed(userId?: string, ctx?: NetCtx, meta?: Record<string, any>) {
    // userId có thể chưa biết (email sai / user không tồn tại)
    return this.logEvent({
      type: 'LOGIN_FAILED',
      userId: userId ?? null,
      sessionId: null,
      ctx,
      meta,
    });
  }

  async tokenRevoke(userId?: string, ctx?: NetCtx, meta?: Record<string, any>) {
    return this.logEvent({
      type: 'TOKEN_REVOKE',
      userId: userId ?? null,
      sessionId: null,
      ctx,
      meta,
    });
  }

  async refreshReuse(
    userId: string,
    sessionId: string,
    ctx?: NetCtx,
    meta?: Record<string, any>,
  ) {
    return this.logEvent({
      type: 'REFRESH_REUSE',
      userId,
      sessionId,
      ctx,
      meta,
    });
  }
}
