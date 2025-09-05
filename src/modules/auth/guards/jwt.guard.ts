// src/auth/jwt.guard.ts
import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from 'src/common/decorators/public.decorator';
import { TokenStateService } from '../token-state.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    private readonly tokenState: TokenStateService,
  ) {
    super();
  }

  async canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const ok = (await super.canActivate(ctx)) as boolean;
    if (!ok) return false;

    const req = ctx.switchToHttp().getRequest<any>();
    const {
      id: userId,
      jti,
      av,
    } = req.user as { id: string; jti: string; av: number };

    if (await this.tokenState.isJtiDenied(jti)) {
      throw new UnauthorizedException('Access token revoked');
    }
    if (await this.tokenState.isUserLocked(userId)) {
      throw new UnauthorizedException('Account temporarily locked');
    }

    const currentAv = await this.tokenState.getAccessVersion(userId);
    if (typeof currentAv === 'number' && currentAv !== av) {
      throw new UnauthorizedException('Access token outdated');
    }

    return true;
  }
}
