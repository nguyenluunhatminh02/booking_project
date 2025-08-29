// rate-limit.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TokenBucketService } from '../token-bucket.service';
import { RATE_LIMIT, RateLimitOpt } from '../decorators/rate-limit.decorator';
import { to429 } from '../errors/app.exception';

const NS = 'v1:rl:tb';

// helper: lấy client IP (đã trust proxy)
function getClientIp(req: any): string {
  const xff = (req.headers['x-forwarded-for'] as string) || '';
  const first = xff.split(',')[0]?.trim();
  return first || req.ip || req.socket?.remoteAddress || 'unknown';
}

// helper: rút gọn subnet
function normalizeIp(ip: string): string {
  // rất đơn giản: IPv4 giữ nguyên, IPv6 rút /64
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return parts.slice(0, 4).join(':') + '::/64';
  }
  // tuỳ bạn có muốn /24: cắt byte cuối
  const m = ip.match(/^(\d+\.\d+\.\d+)\.\d+$/);
  return m ? `${m[1]}.0/24` : ip;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tb: TokenBucketService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const opt = this.reflector.get<RateLimitOpt>(RATE_LIMIT, ctx.getHandler());
    if (!opt) return true;

    const req: any = ctx.switchToHttp().getRequest();
    const ipRaw = getClientIp(req);
    const ip = normalizeIp(ipRaw);
    const userId = req.user?.id;
    const route = req.route?.path ?? req.originalUrl ?? 'unknown';
    const email = req.body?.email?.toLowerCase?.();

    // dùng namespace + route ngắn gọn
    const base =
      route?.toString?.().replace(/\W+/g, ':').replace(/:+/g, ':') || 'route';

    const key =
      opt.keyBy === 'user' && userId
        ? `${NS}:${base}:user:${userId}`
        : opt.keyBy === 'email' && email
          ? `${NS}:${base}:email:${email}`
          : opt.keyBy === 'route'
            ? `${NS}:${base}:route`
            : `${NS}:${base}:ip:${ip}`;

    const dec = await this.tb.consume(key, {
      capacity: opt.capacity,
      refillTokens: opt.refillTokens,
      refillIntervalMs: opt.refillIntervalMs,
      cost: opt.cost ?? 1,
    });

    const res = req.res;
    if (res?.setHeader) {
      res.setHeader('RateLimit-Limit', opt.capacity);
      res.setHeader('RateLimit-Remaining', Math.max(0, dec.remaining));
      res.setHeader('RateLimit-Reset', dec.resetAtSec);
      if (!dec.allowed) res.setHeader('Retry-After', dec.retryAfterSec);
    }

    if (!dec.allowed) throw to429(dec);
    return true;
  }
}
