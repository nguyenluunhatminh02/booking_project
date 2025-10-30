import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagsService } from './feature-flags.service';
import { isEnabledForUser } from './ff-rollout.util';

export const REQUIRE_FLAG_KEY = 'requireFlag';
export const RequireFlag = (key: string) => SetMetadata(REQUIRE_FLAG_KEY, key);

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private ff: FeatureFlagsService,
  ) {}

  canActivate(ctx: ExecutionContext): Promise<boolean> {
    const key = this.reflector.get<string>(REQUIRE_FLAG_KEY, ctx.getHandler());
    if (!key) return Promise.resolve(true); // route không gắn flag
    const req = ctx.switchToHttp().getRequest();
    const userId: string | undefined = req.user?.id;
    return isEnabledForUser(this.ff, key, userId ?? null);
  }
}
