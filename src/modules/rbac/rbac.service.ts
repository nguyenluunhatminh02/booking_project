// src/modules/rbac/rbac.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { normAct, normSub, permKey } from './perms';
import { RbacCacheService } from './rbac_cache.service';

export type ResourceCtx =
  | { resourceType?: string; resourceId?: string }
  | undefined;

@Injectable()
export class RbacService {
  constructor(
    private prisma: PrismaService,
    private cache: RbacCacheService,
  ) {}

  private match(req: string, owned: Set<string>) {
    const [rawSub, rawAct] = req.split(':');
    const sub = normSub(rawSub);
    const act = normAct(rawAct);
    return (
      owned.has(`${sub}:${act}`) ||
      owned.has(`${sub}:manage`) ||
      owned.has(`*:${act}`) ||
      owned.has(`manage:*`)
    );
  }

  private async buildStamp(userId: string, roleIds: string[]) {
    const userVer = await this.cache.getVersion(userId);
    const roleVers = await Promise.all(
      roleIds.map(
        async (r) => [r, await this.cache.getRoleVersion(r)] as const,
      ),
    );
    const sorted = roleVers
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, v]) => `${id}:${v}`)
      .join(',');
    return `${userVer}|${sorted}`;
  }

  async expandUserPermissions(
    userId: string,
    scopeKey = 'GLOBAL',
  ): Promise<Set<string>> {
    const now = new Date();

    // 1) Lấy các role đang hiệu lực (rút gọn điều kiện)
    const roles = await this.prisma.userRole.findMany({
      where: {
        userId,
        AND: [
          { OR: [{ effectiveAt: null }, { effectiveAt: { lte: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      select: { roleId: true },
    });
    const roleIds = roles.map((r) => r.roleId);

    // 2) cache-stamp = userVer + roleVers
    const stamp = await this.buildStamp(userId, roleIds);

    // 3) cache hit?
    const cached = await this.cache.getPerms(userId, scopeKey, stamp);
    if (cached) return new Set(cached);

    // 3.5) Không có role nào → cache & trả sớm
    if (roleIds.length === 0) {
      await this.cache.setPerms(userId, scopeKey, stamp, []);
      return new Set<string>();
    }

    // 4) Lấy permission theo role (distinct để tránh trùng)
    const rolePerms = await this.prisma.rolePermission.findMany({
      where: { roleId: { in: roleIds } },
      select: { permission: { select: { subject: true, action: true } } },
      distinct: ['permissionId'], // tránh duplicate nếu 2 role cùng 1 permission
    });

    const perms = [
      ...new Set(
        rolePerms.map((rp) =>
          // permKey() đã normalize lowercase để khớp DB/cache nội bộ
          permKey(rp.permission.subject, rp.permission.action),
        ),
      ),
    ];

    await this.cache.setPerms(userId, scopeKey, stamp, perms);
    return new Set(perms);
  }

  private async applyAcl(
    userId: string,
    owned: Set<string>,
    resource: { resourceType: string; resourceId: string },
  ) {
    const acl = await this.prisma.resourceACL.findMany({
      where: {
        userId,
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
      },
      select: { resourceType: true, action: true, effect: true },
    });

    const denies = new Set(
      acl
        .filter((a) => a.effect === 'DENY')
        .map((a) => permKey(a.resourceType, a.action)),
    );

    for (const a of acl)
      if (a.effect === 'ALLOW') owned.add(permKey(a.resourceType, a.action));

    return denies;
  }

  // (Tuỳ chọn) Rule “chủ sở hữu có manage”
  private async applyOwnershipBoost(
    userId: string,
    owned: Set<string>,
    resource?: ResourceCtx,
  ) {
    if (!resource?.resourceType || !resource?.resourceId) return;

    const type = normSub(resource.resourceType);
    if (type === 'property') {
      const p = await this.prisma.property.findUnique({
        where: { id: resource.resourceId },
        select: { hostId: true },
      });
      if (p?.hostId === userId) {
        owned.add('property:manage');
      }
    }

    // 👇 Chính chủ user => user:manage
    if (type === 'user' && resource.resourceId === userId) {
      owned.add('user:manage'); // sẽ pass cho mọi action nhờ match(): user:manage ⊇ user:update
    }
    // thêm domain khác nếu cần…
  }

  async checkPermissions(
    userId: string,
    needed: string[],
    resource?: ResourceCtx,
    scopeKey = 'GLOBAL',
  ) {
    if (!needed?.length) return { allowed: true as const };

    // normalize các yêu cầu
    const reqs = needed.map((r) => {
      const [s, a] = r.split(':');
      return permKey(s || '', a || '');
    });

    const owned = await this.expandUserPermissions(userId, scopeKey);

    await this.applyOwnershipBoost(userId, owned, resource);

    let denies: Set<string> | undefined;
    if (resource?.resourceType && resource?.resourceId) {
      denies = await this.applyAcl(userId, owned, {
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
      });
    }

    const failed: string[] = [];
    for (const r of reqs) {
      if (denies?.has(r)) failed.push(r);
      else if (!this.match(r, owned)) failed.push(r);
    }

    return {
      allowed: failed.length === 0,
      failed: failed.length ? failed : undefined,
    };
  }
}
