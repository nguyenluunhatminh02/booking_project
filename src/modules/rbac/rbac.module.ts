import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RbacService } from 'src/modules/rbac/rbac.service';
import { RbacAdminService } from 'src/modules/rbac/rbac-admin.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { RbacCacheService } from './rbac_cache.service';
import { AdminRbacController } from './admin-rbac.controller';
import { PermissionsGuard } from './guards/permissions.guard';
import { RoleGuard } from './guards/role.guard';

@Module({
  providers: [
    PrismaService,
    RbacCacheService,
    RbacService,
    RbacAdminService,
    { provide: APP_GUARD, useClass: PermissionsGuard }, // guard global (hoặc @UseGuards tại controller)
    { provide: APP_GUARD, useClass: RoleGuard },
  ],
  exports: [RbacService, RbacAdminService],
  controllers: [AdminRbacController],
})
export class RbacModule {}
