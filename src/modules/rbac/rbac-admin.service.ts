// src/modules/rbac/rbac-admin.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ACLEffect } from '@prisma/client';
import { Action, asDbAction, asDbSubject, Subject } from './perms';
import { RbacCacheService } from './rbac_cache.service';

@Injectable()
export class RbacAdminService {
  constructor(
    private prisma: PrismaService,
    private cache: RbacCacheService,
  ) {}

  // ---------- User ↔ Role ----------
  async addRoleToUser(userId: string, roleId: string) {
    await this.prisma.userRole.upsert({
      where: { user_role_unique: { userId, roleId } },
      update: {},
      create: { userId, roleId },
    });
    await this.cache.bumpUser(userId);
    return { ok: true };
  }

  async removeRoleFromUser(userId: string, roleId: string) {
    await this.prisma.userRole.deleteMany({ where: { userId, roleId } });
    await this.cache.bumpUser(userId);
    return { ok: true };
  }

  // ---------- Role ↔ Permission ----------
  async addPermissionToRole(roleId: string, subject: Subject, action: string) {
    const sub = asDbSubject(subject);
    const act = asDbAction(action);

    const perm = await this.prisma.permission.upsert({
      where: { action_subject: { action: act, subject: sub } },
      update: {},
      create: { action: act, subject: sub },
      select: { id: true },
    });

    await this.prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId: perm.id } },
      update: {},
      create: { roleId, permissionId: perm.id },
    });

    await this.cache.bumpRole(roleId);
    return { ok: true };
  }

  async removePermissionFromRole(
    roleId: string,
    subject: Subject,
    action: string,
  ) {
    const sub = asDbSubject(subject);
    const act = asDbAction(action);

    const perm = await this.prisma.permission.findUnique({
      where: { action_subject: { action: act, subject: sub } },
      select: { id: true },
    });
    if (!perm) return { ok: true, already: true };

    await this.prisma.rolePermission.deleteMany({
      where: { roleId, permissionId: perm.id },
    });

    await this.cache.bumpRole(roleId);
    return { ok: true };
  }

  // ---------- Resource ACL ----------
  async grantAcl(p: {
    userId: string;
    resourceType: Subject;
    resourceId: string;
    action: Action;
    effect?: ACLEffect;
  }) {
    const { userId, resourceType, resourceId, action, effect = 'ALLOW' } = p;
    await this.prisma.resourceACL.upsert({
      where: {
        user_resource_action_unique: {
          userId,
          resourceType: asDbSubject(resourceType),
          resourceId,
          action: asDbAction(action),
        },
      },
      update: { effect },
      create: {
        userId,
        resourceType: asDbSubject(resourceType),
        resourceId,
        action: asDbAction(action),
        effect,
      },
    });
    await this.cache.bumpUser(userId);
    return { ok: true };
  }

  async revokeAcl(
    userId: string,
    resourceType: Subject,
    resourceId: string,
    action: Action,
  ) {
    await this.prisma.resourceACL.deleteMany({
      where: {
        userId,
        resourceType: asDbSubject(resourceType),
        resourceId,
        action: asDbAction(action),
      },
    });
    await this.cache.bumpUser(userId);
    return { ok: true };
  }
}
