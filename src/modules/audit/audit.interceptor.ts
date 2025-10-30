import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { AuditLogService } from './audit-log.service';
import {
  AUDIT_META_KEY,
  AuditSpec,
} from 'src/common/decorators/audit.decorator';

function pickFrom(req: any, sel?: { in: string; key: string }) {
  if (!sel) return undefined;
  const bag =
    sel.in === 'params'
      ? req.params
      : sel.in === 'query'
        ? req.query
        : sel.in === 'body'
          ? req.body
          : req.headers;
  const v = bag?.[sel.key];
  return Array.isArray(v) ? v[0] : v;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditLogService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();

    const spec = this.reflector.getAllAndOverride<AuditSpec>(AUDIT_META_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const start = Date.now();
    const actorId: string | undefined = req.user?.id;
    const ip = (req.ip ??
      req.headers['x-forwarded-for'] ??
      req.socket?.remoteAddress) as string | undefined;
    const ua = (req.headers['user-agent'] as string | undefined) ?? undefined;

    // Thông tin HTTP cơ bản
    const path = req.originalUrl ?? req.url;
    const method = req.method;

    // Mặc định nếu không gắn @Audit(...)
    let action = 'HTTP_CALL';
    let entity = 'HTTP';
    let entityId: string | undefined;

    if (spec) {
      action = spec['action'] || action;
      entity = spec['entity'] || entity;
      if ('idSelector' in spec && spec.idSelector) {
        const raw = pickFrom(req, spec.idSelector);
        entityId = raw != null ? String(raw) : undefined;
      }
    }

    const baseMeta = {
      path,
      method,
    };

    return next.handle().pipe(
      tap((result) => {
        const resolvedId =
          spec && 'resolveId' in spec && typeof spec.resolveId === 'function'
            ? (spec.resolveId(req, res, result) ?? entityId)
            : entityId;

        const durationMs = Date.now() - start;
        const status = res.statusCode ?? 200;

        void this.audit
          .log({
            actorId,
            action,
            entity,
            entityId: resolvedId,
            meta: { ...baseMeta, status, ok: true, durationMs },
            ctx: { ip, ua },
          })
          .catch(() => undefined);
      }),
      catchError((err) => {
        const durationMs = Date.now() - start;
        const status = err?.status ?? res.statusCode ?? 500;
        void this.audit
          .log({
            actorId,
            action,
            entity,
            entityId,
            meta: {
              ...baseMeta,
              status,
              ok: false,
              durationMs,
              error: {
                name: err?.name,
                message: err?.message,
              },
            },
            ctx: { ip, ua },
          })
          .catch(() => undefined);
        return throwError(() => err);
      }),
    );
  }
}
