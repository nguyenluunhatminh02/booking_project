// src/modules/rbac/permissions.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IdSelector } from '../perms';
import { RbacService } from '../rbac.service';
import {
  PermRequirement,
  REQUIRE_PERMS_KEY,
  RESOURCE_META_KEY,
} from '../decorators/permissions.decorator';

function pickFrom(req: any, sel?: IdSelector): string | undefined {
  if (!sel) return undefined;
  const bag =
    sel.in === 'params'
      ? req.params
      : sel.in === 'query'
        ? req.query
        : sel.in === 'body'
          ? req.body
          : req.headers;
  const val = bag?.[sel.key];
  return Array.isArray(val) ? val[0] : val;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private rbac: RbacService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as { id: string } | undefined;

    const permMeta = this.reflector.getAllAndOverride<PermRequirement>(
      REQUIRE_PERMS_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    const resourceMeta = this.reflector.getAllAndOverride(RESOURCE_META_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (!permMeta) return true;
    if (!user) throw new ForbiddenException('No user in request');

    const perms = Array.isArray(permMeta) ? permMeta : permMeta.perms || [];
    const mode: 'all' | 'any' = Array.isArray(permMeta)
      ? 'all'
      : (permMeta.mode ?? 'all');
    if (!perms.length) return true;

    const resourceType = resourceMeta?.type;
    const resourceId = pickFrom(req, resourceMeta?.idSelector);

    if (mode === 'all') {
      const res = await this.rbac.checkPermissions(user.id, perms, {
        resourceType,
        resourceId,
      });
      if (!res.allowed)
        throw new ForbiddenException(
          `Missing permissions: ${res.failed?.join(', ')}`,
        );
      return true;
    }

    // any
    for (const p of perms) {
      const ok = await this.rbac.checkPermissions(user.id, [p], {
        resourceType,
        resourceId,
      });
      if (ok.allowed) return true;
    }
    throw new ForbiddenException(`Need any of: ${perms.join(', ')}`);
  }
}
