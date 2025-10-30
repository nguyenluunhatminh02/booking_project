// token-bucket.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { RedisService } from 'src/common/redis.service';

type ConsumeOpts = {
  capacity: number; // sức chứa tối đa
  refillTokens: number; // n token được nạp
  refillIntervalMs: number; // mỗi khoảng thời gian (ms)
  cost?: number; // token cần cho 1 request (mặc định 1)
  ttlSec?: number; // TTL key (mặc định 2 * thời gian nạp đầy)
};

export type TbDecision = {
  allowed: boolean;
  remaining: number; // token còn lại sau khi (cố) tiêu thụ
  retryAfterSec: number; // nếu bị chặn -> còn bao giây mới đủ token
  resetAtSec: number; // epoch seconds khi bucket nạp đủ “cost” (ước lượng)
};

const NS = 'v1:rl:tb';

@Injectable()
export class TokenBucketService implements OnModuleInit {
  private sha?: string;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit() {
    if (!this.redis.enabled) return;
    const lua = `
      -- KEYS[1] = hash key
      -- ARGV[1] = now (ms)
      -- ARGV[2] = capacity
      -- ARGV[3] = refillTokens
      -- ARGV[4] = refillIntervalMs
      -- ARGV[5] = cost
      -- ARGV[6] = ttlSec

      local key      = KEYS[1]
      local nowMs    = tonumber(ARGV[1])
      local capacity = tonumber(ARGV[2])
      local refillTokens = tonumber(ARGV[3])
      local refillIntervalMs = tonumber(ARGV[4])
      local cost     = tonumber(ARGV[5])
      local ttlSec   = tonumber(ARGV[6])

      if cost <= 0 then cost = 1 end
      if capacity < cost then capacity = cost end

      local refillRate = refillTokens / refillIntervalMs -- tokens per ms

      local h = redis.call('HGETALL', key)
      local tokens = 0
      local ts = nowMs

      if next(h) == nil then
        tokens = capacity
        ts = nowMs
      else
        for i=1,#h,2 do
          if h[i] == 'tokens' then tokens = tonumber(h[i+1]) end
          if h[i] == 'ts' then ts = tonumber(h[i+1]) end
        end
        -- refill
        local delta = nowMs - ts
        if delta < 0 then delta = 0 end
        local add = delta * refillRate
        tokens = math.min(capacity, tokens + add)
      end

      local allowed = 0
      if tokens >= cost then
        tokens = tokens - cost
        allowed = 1
      end

      -- update state
      redis.call('HMSET', key, 'tokens', tokens, 'ts', nowMs)

      -- ensure TTL
      if ttlSec and ttlSec > 0 then
        redis.call('EXPIRE', key, ttlSec)
      end

      local remaining = math.floor(tokens + 0.00001) -- để trả integer đẹp

      local retryAfterSec = 0
      if allowed == 0 then
        local need = cost - tokens
        local ms = need / refillRate
        retryAfterSec = math.ceil(ms / 1000.0)
      end

      local resetAtSec = math.floor((nowMs / 1000.0) + retryAfterSec + 0.5)

      return { allowed, remaining, retryAfterSec, resetAtSec }
    `;
    this.sha = (await this.redis.scriptLoad(lua)) as any;
  }

  /**
   * Consume token theo token bucket. Trả quyết định + meta.
   */
  async consume(bucketKey: string, opts: ConsumeOpts): Promise<TbDecision> {
    if (!this.redis.enabled || !this.sha) {
      // fallback: cho qua, hoặc bạn có thể chặn “fail-closed” tuỳ policy
      return {
        allowed: true,
        remaining: opts.capacity,
        retryAfterSec: 0,
        resetAtSec: Math.floor(Date.now() / 1000),
      };
    }

    const { capacity, refillTokens, refillIntervalMs } = opts;
    if (refillTokens <= 0 || refillIntervalMs <= 0) {
      // fail-safe: coi như không cho qua
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: 1,
        resetAtSec: Math.floor(Date.now() / 1000) + 1,
      };
    }
    const cost = Math.max(1, opts.cost ?? 1);

    // TTL mặc định: gấp 2 thời gian để nạp đầy bucket (ms -> s)
    const timeToFullMs = capacity / (refillTokens / refillIntervalMs);
    const defaultTtlSec = Math.max(1, Math.floor((2 * timeToFullMs) / 1000));
    const ttlSec =
      opts.ttlSec !== undefined
        ? Math.max(1, Math.floor(opts.ttlSec))
        : defaultTtlSec;

    const key = `${NS}:${bucketKey}`;
    const nowMs = Date.now();

    const res = (await this.redis.evalsha(
      this.sha,
      [key],
      [nowMs, capacity, refillTokens, refillIntervalMs, cost, ttlSec],
    )) as any;

    // res = { allowed, remaining, retryAfterSec, resetAtSec }
    return {
      allowed: !!res?.[0],
      remaining: Number(res?.[1] ?? 0),
      retryAfterSec: Number(res?.[2] ?? 0),
      resetAtSec: Number(res?.[3] ?? 0),
    };
  }
}
