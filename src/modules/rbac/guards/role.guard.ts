// src/modules/rbac/guards/role.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  REQUIRE_ROLE_KEY,
  REQUIRE_ANY_ROLE_KEY,
} from '../decorators/role.decorator';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const roleName = this.reflector.getAllAndOverride<string>(
      REQUIRE_ROLE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    const roleNames = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_ANY_ROLE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    if (!roleName && !roleNames) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user as { id: string } | undefined;
    if (!user) throw new ForbiddenException('No user in request');

    // 1) Yêu cầu một role cụ thể
    if (roleName) {
      const match = await this.prisma.userRole.findFirst({
        where: { userId: user.id, role: { name: roleName } },
        select: { id: true },
      });
      if (!match) throw new ForbiddenException(`Require role ${roleName}`);
      return true;
    }

    // 2) Yêu cầu ít nhất một trong số các role
    if (roleNames) {
      const count = await this.prisma.userRole.count({
        where: { userId: user.id, role: { name: { in: roleNames } } },
      });
      if (count === 0) {
        throw new ForbiddenException(
          `Require one of roles: ${roleNames.join(', ')}`,
        );
      }
      return true;
    }

    return true;
  }
}
