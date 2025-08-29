import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis, { Redis as RedisClient } from 'ioredis';

type SetOpts = {
  ttlSec?: number; // EX seconds
  nx?: boolean; // only-if-not-exists
  xx?: boolean; // only-if-exists
};

@Injectable()
export class RedisService implements OnModuleDestroy {
  private redis?: RedisClient;
  private log = new Logger('Redis');

  constructor() {
    const url = process.env.REDIS_URL;
    const commonOpts = {
      maxRetriesPerRequest: null as any, // tránh “Queue full” với long ops
      // retryStrategy: (times: number) => Math.min(1000 * times, 15000),
      // enableReadyCheck: true, // mặc định true
      // lazyConnect: false,
    };

    try {
      this.redis = url
        ? new Redis(url, commonOpts)
        : new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: +(process.env.REDIS_PORT || 6379),
            // password: process.env.REDIS_PASSWORD, // nếu có
            // tls: {}, // nếu dùng TLS
            ...commonOpts,
          });

      this.redis.on('connect', () => this.log.log('Redis connecting...'));
      this.redis.on('ready', () => this.log.log('Redis ready'));
      this.redis.on('reconnecting', () => this.log.warn('Redis reconnecting'));
      this.redis.on('end', () => this.log.warn('Redis connection ended'));
      this.redis.on('error', (e) =>
        this.log.warn('Redis error: ' + e?.message),
      );
    } catch (e: any) {
      this.log.warn('Redis init failed: ' + e?.message);
    }
  }

  get enabled() {
    return this.redis?.status === 'ready';
  }

  async onModuleDestroy() {
    try {
      await this.redis?.quit();
    } catch {
      this.redis?.disconnect();
    }
  }

  // ---------------- Core ----------------
  async set(key: string, value: string, opts: SetOpts = {}) {
    if (!this.redis) return null;

    const args: (string | number)[] = [key, value];

    if (opts.ttlSec && opts.ttlSec > 0) {
      args.push('EX', opts.ttlSec);
    }
    if (opts.nx && opts.xx) {
      throw new Error('NX and XX are mutually exclusive');
    }
    if (opts.nx) args.push('NX');
    if (opts.xx) args.push('XX');

    // Trả về 'OK' hoặc null nếu NX/XX không thỏa
    // eslint-disable-next-line prefer-spread
    return await this.redis.set.apply(this.redis, args as any);
  }

  async get(key: string) {
    if (!this.redis) return null;
    return this.redis.get(key);
  }

  async del(key: string) {
    if (!this.redis) return 0;
    return this.redis.del(key);
  }

  async incr(key: string) {
    if (!this.redis) return 0;
    return this.redis.incr(key);
  }

  async expire(key: string, ttlSec: number) {
    if (!this.redis) return 0;
    return this.redis.expire(key, ttlSec);
  }

  async ttl(key: string) {
    if (!this.redis) return -2; // -2 = not exist | theo Redis conv.
    return this.redis.ttl(key);
  }

  async mget(keys: string[]) {
    if (!this.redis) return keys.map(() => null);
    if (!keys.length) return [];
    return this.redis.mget(...keys);
  }

  // ---------------- Sugar helpers ----------------
  async setNx(key: string, value: string, ttlSec?: number) {
    return this.set(key, value, { ttlSec, nx: true });
  }

  async setEx(key: string, value: string, ttlSec: number) {
    return this.set(key, value, { ttlSec });
  }

  // TOKEN BUCKET
  async scriptLoad(script: string) {
    if (!this.redis) return null;
    return this.redis.script('LOAD', script);
  }

  async evalsha(sha: string, keys: string[], args: (string | number)[]) {
    if (!this.redis) return null;
    return this.redis.evalsha(sha, keys.length, ...keys, ...args);
  }
}
