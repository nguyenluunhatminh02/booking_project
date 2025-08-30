// src/modules/rbac/cache.service.ts
import { Injectable, Logger } from '@nestjs/common';
import IORedis from 'ioredis';

@Injectable()
export class RbacCacheService {
  private redis?: IORedis;
  private log = new Logger('RbacCache');
  private mem = new Map<string, { value: any; exp: number }>();
  private memVer = new Map<string, number>(); // user version (local)
  private memRoleVer = new Map<string, number>(); // role version (local)

  private ttlMs = 5 * 60_000;
  private pfx = 'rbac';

  constructor() {
    const url = process.env.REDIS_URL;
    if (url) {
      this.redis = new IORedis(url);
      this.redis.on('error', (e) => this.log.warn(e.message));
    }
  }

  private verKey = (u: string) => `${this.pfx}:ver:user:${u}`;
  private roleVerKey = (r: string) => `${this.pfx}:ver:role:${r}`;
  private permKey = (u: string, scope: string, stamp: string) =>
    `${this.pfx}:perm:user:${u}:${scope}:${stamp}`;

  // ---------- User version ----------
  async getVersion(userId: string) {
    if (this.redis) {
      const v = await this.redis.get(this.verKey(userId));
      if (v) return +v;
      await this.redis.set(this.verKey(userId), '1');
      return 1;
    }
    const v = this.memVer.get(userId);
    if (v) return v;
    this.memVer.set(userId, 1);
    return 1;
  }

  async bumpUser(userId: string) {
    if (this.redis) return await this.redis.incr(this.verKey(userId));
    const next = (this.memVer.get(userId) ?? 1) + 1;
    this.memVer.set(userId, next);
    for (const k of Array.from(this.mem.keys()))
      if (k.includes(`perm:user:${userId}:`)) this.mem.delete(k);
    return next;
  }

  // ---------- Role version ----------
  async getRoleVersion(roleId: string) {
    if (this.redis) {
      const v = await this.redis.get(this.roleVerKey(roleId));
      if (v) return +v;
      await this.redis.set(this.roleVerKey(roleId), '1');
      return 1;
    }
    const v = this.memRoleVer.get(roleId);
    if (v) return v;
    this.memRoleVer.set(roleId, 1);
    return 1;
  }

  async bumpRole(roleId: string) {
    if (this.redis) return await this.redis.incr(this.roleVerKey(roleId));
    const next = (this.memRoleVer.get(roleId) ?? 1) + 1;
    this.memRoleVer.set(roleId, next);
    return next;
  }

  // ---------- Raw helpers ----------
  private async getRaw<T>(k: string) {
    if (this.redis) {
      const raw = await this.redis.get(k);
      return raw ? (JSON.parse(raw) as T) : null;
    }
    const e = this.mem.get(k);
    if (!e) return null;
    if (Date.now() > e.exp) {
      this.mem.delete(k);
      return null;
    }
    return e.value as T;
  }

  private async setRaw<T>(k: string, v: T, ttl = this.ttlMs) {
    if (this.redis) await this.redis.set(k, JSON.stringify(v), 'PX', ttl);
    else this.mem.set(k, { value: v, exp: Date.now() + ttl });
  }

  // ---------- Perms cache theo stamp ----------
  async getPerms(userId: string, scopeKey: string, stamp: string) {
    return this.getRaw<string[]>(this.permKey(userId, scopeKey, stamp));
  }
  async setPerms(
    userId: string,
    scopeKey: string,
    stamp: string,
    perms: string[],
    ttlMs = this.ttlMs,
  ) {
    await this.setRaw(this.permKey(userId, scopeKey, stamp), perms, ttlMs);
  }
}
