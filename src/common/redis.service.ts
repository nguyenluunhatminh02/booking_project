import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis, { Redis as RedisClient, RedisOptions } from 'ioredis';

type SetOpts = { ttlSec?: number; nx?: boolean; xx?: boolean };

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private redis?: RedisClient;
  private log = new Logger('Redis');

  // Lua: unlock chỉ khi value == token (tránh unlock nhầm)
  private readonly UNLOCK_LUA = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;
  private unlockSha?: string;

  constructor() {
    const url = process.env.REDIS_URL;
    const keyPrefix =
      process.env.REDIS_PREFIX || `${process.env.NODE_ENV || 'dev'}:`; // <-- prefix theo env

    const commonOpts: RedisOptions = {
      keyPrefix, // <-- prefix hoá toàn bộ keys
      maxRetriesPerRequest: null as any, // ioredis: disable limit để tránh “Queue full”
      retryStrategy: (times) => Math.min(1000 * times, 10_000), // backoff mượt 1s..10s
      enableReadyCheck: true,
      // lazyConnect: true,            // nếu muốn chủ động this.redis.connect() ở onModuleInit
      // tls: {},                      // nếu dùng rediss://
    };

    try {
      this.redis = url
        ? new Redis(url, commonOpts)
        : new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: +(process.env.REDIS_PORT || 6379),
            // password: process.env.REDIS_PASSWORD,
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

  async onModuleInit() {
    // Nếu dùng lazyConnect, gọi connect() ở đây
    if (this.redis && this.redis.status === 'wait') {
      await this.redis.connect().catch(() => undefined);
    }
    // Preload Lua script (tùy chọn, sẽ tự eval nếu chưa load)
    try {
      if (this.redis)
        this.unlockSha = (await this.redis.script(
          'LOAD',
          this.UNLOCK_LUA,
        )) as string;
    } catch {
      /* empty */
    }
  }

  getClient() {
    if (!this.redis) throw new Error('Redis client is not initialized');
    return this.redis;
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

  // -------- Core KV --------
  set(key: string, value: string, opts: SetOpts = {}) {
    if (!this.redis) return null;
    const args: (string | number)[] = [key, value];
    if (opts.ttlSec && opts.ttlSec > 0) args.push('EX', opts.ttlSec);
    if (opts.nx && opts.xx) throw new Error('NX and XX are mutually exclusive');
    if (opts.nx) args.push('NX');
    if (opts.xx) args.push('XX');
    const extraArgs = args
      .slice(2)
      .map((arg) => (typeof arg === 'number' ? String(arg) : arg));
    return (this.redis as any).set(key, value, ...extraArgs); // 'OK' | null
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
    if (!this.redis) return -2; // -2 = not exist
    return this.redis.ttl(key);
  }

  async mget(keys: string[]) {
    if (!this.redis) return keys.map(() => null);
    if (!keys.length) return [];
    return this.redis.mget(...keys);
  }

  // -------- Sugar helpers --------
  async setNx(key: string, value: string, ttlSec?: number) {
    return this.set(key, value, { ttlSec, nx: true });
  }

  async setEx(key: string, value: string, ttlSec: number) {
    return this.set(key, value, { ttlSec });
  }

  // JSON helpers
  async setJSON<T>(key: string, obj: T, ttlSec?: number) {
    return this.set(key, JSON.stringify(obj), { ttlSec });
  }
  async getJSON<T = unknown>(key: string): Promise<T | null> {
    const s = await this.get(key);
    if (!s) return null;
    try {
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  }

  // Health
  async ping(): Promise<boolean> {
    if (!this.redis) return false;
    try {
      const r = await this.redis.ping();
      return r === 'PONG';
    } catch {
      return false;
    }
  }

  // -------- Lightweight lock (SET NX EX) --------
  /**
   * acquireLock: giữ khoá theo token (string tuỳ bạn sinh). Trả true nếu giữ được.
   * Ví dụ: await acquireLock('job:expire', token, 30)
   */
  async acquireLock(
    key: string,
    token: string,
    ttlSec: number,
  ): Promise<boolean> {
    const ok = await this.set(key, token, { ttlSec, nx: true });
    return ok === 'OK';
  }

  /**
   * releaseLock: chỉ nhả khoá nếu token khớp (an toàn khi hết hạn/renew).
   */
  async releaseLock(key: string, token: string): Promise<boolean> {
    if (!this.redis) return false;
    try {
      const sha =
        this.unlockSha ?? (await this.redis.script('LOAD', this.UNLOCK_LUA));
      const res = (await this.redis.evalsha(
        sha as string,
        1,
        key,
        token,
      )) as number;
      return res === 1;
    } catch {
      // Fallback eval trực tiếp nếu script chưa load
      try {
        const res = (await this.redis.eval(
          this.UNLOCK_LUA,
          1,
          key,
          token,
        )) as number;
        return res === 1;
      } catch {
        return false;
      }
    }
  }

  // Token bucket (bạn đã có scriptLoad/evalsha; giữ nguyên)
  async scriptLoad(script: string) {
    if (!this.redis) return null;
    return this.redis.script('LOAD', script);
  }

  async evalsha(sha: string, keys: string[], args: (string | number)[]) {
    if (!this.redis) return null;
    return this.redis.evalsha(sha, keys.length, ...keys, ...args);
  }
}
