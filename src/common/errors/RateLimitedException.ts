import { AppException } from './app.exception';

export const RateLimitedException = (
  retryAfterSec: number,
  detail?: string,
  ctx?: { limit?: number; remaining?: number; reset?: number }, // optional
) =>
  new AppException({
    title: 'Too many requests. Try later.',
    status: 429,
    code: 'RATE_LIMITED',
    retryAfterSec,
    detail,
    headers: {
      ...(ctx?.limit != null ? { 'RateLimit-Limit': ctx.limit } : {}),
      ...(ctx?.remaining != null
        ? { 'RateLimit-Remaining': ctx.remaining }
        : {}),
      ...(ctx?.reset != null ? { 'RateLimit-Reset': ctx.reset } : {}),
      'Retry-After': retryAfterSec,
    },
  });
