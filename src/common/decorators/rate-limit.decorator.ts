// rate-limit.decorator.ts
import { SetMetadata } from '@nestjs/common';
export type RateLimitOpt = {
  capacity: number; // số token trong bucket
  refillTokens: number; // số token nạp mỗi khoảng
  refillIntervalMs: number; // khoảng nạp (ms)
  keyBy?: 'ip' | 'user' | 'route' | 'email';
  cost?: number;
};
export const RATE_LIMIT = 'rate_limit';
export const RateLimit = (opt: RateLimitOpt) => SetMetadata(RATE_LIMIT, opt);
