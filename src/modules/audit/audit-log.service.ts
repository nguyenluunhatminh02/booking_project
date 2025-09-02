import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

export type AuditCtx = { ip?: string; ua?: string };
export type AuditPayload = {
  actorId?: string | null;
  action: string; // e.g. 'PROPERTY_UPDATE', 'USER_LOGIN', 'HTTP_CALL'
  entity: string; // e.g. 'Property', 'User', 'HTTP'
  entityId?: string | null;
  meta?: any; // thêm thông tin phụ (path, method, status, duration,...)
  ctx?: AuditCtx;
};

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(p: AuditPayload) {
    const { actorId, action, entity, entityId, meta, ctx } = p;

    const mergedMeta =
      ctx?.ip || ctx?.ua
        ? { ...(meta ?? {}), _ctx: { ip: ctx?.ip, ua: ctx?.ua } }
        : meta;

    return this.prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        action,
        entity,
        entityId: entityId ?? null,
        meta: mergedMeta ?? undefined,
      },
    });
  }
}
