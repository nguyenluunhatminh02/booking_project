import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequirePermissions } from './decorators/permissions.decorator';
import { P } from './perms';
import { RbacAdminService } from './rbac-admin.service';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  AddRoleDto,
  RemoveRoleDto,
  RoleAddPermissionDto,
  RoleRemovePermissionDto,
  GrantAclDto,
  RevokeAclDto,
} from './dto/rbac.dto';
import { RbacService } from './rbac.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';

@UseGuards(JwtAuthGuard) // PermissionsGuard đang global trong RbacModule; nếu không, @UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/rbac')
export class AdminRbacController {
  constructor(
    private readonly rbacAdmin: RbacAdminService,
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  // --- USER <-> ROLE ---------------------------------------------------------

  @RequirePermissions(P.Role.manage)
  @Post('add-role')
  addRole(@Body() dto: AddRoleDto) {
    return this.rbacAdmin.addRoleToUser(dto.userId, dto.roleId);
  }

  @RequirePermissions(P.Role.manage)
  @Post('remove-role')
  removeRole(@Body() dto: RemoveRoleDto) {
    return this.rbacAdmin.removeRoleFromUser(dto.userId, dto.roleId);
  }

  @RequirePermissions(P.Role.read)
  @Get('user/:userId/roles')
  async listUserRoles(@Param('userId') userId: string) {
    const rows = await this.prisma.userRole.findMany({
      where: { userId },
      select: {
        role: { select: { id: true, name: true, desc: true, isSystem: true } },
        effectiveAt: true,
        expiresAt: true,
      },
      orderBy: { role: { name: 'asc' } },
    });
    return rows;
  }

  // --- ROLE <-> PERMISSION ---------------------------------------------------

  @RequirePermissions(P.Permission.manage)
  @Post('role/add-permission')
  addPerm(@Body() dto: RoleAddPermissionDto) {
    return this.rbacAdmin.addPermissionToRole(
      dto.roleId,
      dto.subject,
      dto.action,
    );
  }

  @RequirePermissions(P.Permission.manage)
  @Post('role/remove-permission')
  removePerm(@Body() dto: RoleRemovePermissionDto) {
    return this.rbacAdmin.removePermissionFromRole(
      dto.roleId,
      dto.subject,
      dto.action,
    );
  }

  @RequirePermissions(P.Permission.read)
  @Get('role/:roleId/permissions')
  async listRolePerms(@Param('roleId') roleId: string) {
    const rows = await this.prisma.rolePermission.findMany({
      where: { roleId },
      select: { permission: { select: { subject: true, action: true } } },
      orderBy: [
        { permission: { subject: 'asc' } },
        { permission: { action: 'asc' } },
      ],
    });
    return rows.map((r) => `${r.permission.subject}:${r.permission.action}`);
  }

  // --- ACL PER-RECORD --------------------------------------------------------

  @RequirePermissions(P.Permission.manage)
  @Post('grant-acl')
  grantAcl(@Body() dto: GrantAclDto) {
    return this.rbacAdmin.grantAcl(dto);
  }

  @RequirePermissions(P.Permission.manage)
  @Post('revoke-acl')
  revokeAcl(@Body() dto: RevokeAclDto) {
    const { userId, resourceType, resourceId, action } = dto;
    return this.rbacAdmin.revokeAcl(userId, resourceType, resourceId, action);
  }

  @RequirePermissions(P.Permission.read)
  @Get('acl')
  listAcl(
    @Query('userId') userId: string,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
  ) {
    return this.prisma.resourceACL.findMany({
      where: {
        userId,
        resourceType: resourceType?.toLowerCase(),
        resourceId,
      },
      select: {
        resourceType: true,
        resourceId: true,
        action: true,
        effect: true,
        createdAt: true,
      },
      orderBy: [
        { resourceType: 'asc' },
        { resourceId: 'asc' },
        { action: 'asc' },
      ],
    });
  }

  // --- DEBUG / OBSERVABILITY -------------------------------------------------

  /**
   * Mở rộng quyền của user (sau cache): trả về mảng string 'subject:action'
   * Query:
   *   - userId (bắt buộc)
   *   - scopeKey? (multi-tenant)
   *   - resourceType? resourceId? (để check ACL/ownership)
   *   - needed? (comma-separated) => nếu truyền, trả thêm { allowed, failed[] }
   */
  @RequirePermissions(P.Permission.read)
  @Get('debug/perms')
  async debugPerms(
    @Query('userId') userId: string,
    @Query('scopeKey') scopeKey = 'GLOBAL',
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
    @Query('needed') neededCsv?: string,
  ) {
    const owned = await this.rbac.expandUserPermissions(userId, scopeKey);
    const ownedArr = Array.from(owned.values()).sort();

    if (!neededCsv) {
      return { userId, scopeKey, owned: ownedArr };
    }

    const needed = neededCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const check = await this.rbac.checkPermissions(
      userId,
      needed,
      resourceType && resourceId ? { resourceType, resourceId } : undefined,
      scopeKey,
    );

    return {
      userId,
      scopeKey,
      owned: ownedArr,
      needed,
      ...check,
    };
  }
}
