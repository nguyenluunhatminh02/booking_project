// src/modules/auth/token-state.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from './../../prisma/prisma.service';

const NS = 'v1:auth';
const SKEW_SEC = 60;

@Injectable()
export class TokenStateService {
  constructor(
    private redis: RedisService,
    private prisma: PrismaService,
  ) {}

  // ------------ Keys ------------
  private accVerKey = (u: string) => `${NS}:accver:${u}`;
  private denyJtiKey = (j: string) => `${NS}:deny:jti:${j}`; // đơn giản hoá: chỉ theo jti
  private lockKey = (u: string) => `${NS}:lock:user:${u}`;
  private svKey = (sid: string) => `${NS}:sv:${sid}`;

  // ------------ Safe helpers ------------
  private async safeGet(key: string) {
    if (!this.redis.enabled) return null;
    return this.redis.get(key);
  }
  private async safeSetNx(key: string, val: string, ttlSec?: number) {
    if (!this.redis.enabled) return null;
    return this.redis.setNx(key, val, ttlSec);
  }
  private async safeSet(key: string, val: string, ttlSec?: number) {
    if (!this.redis.enabled) return null;
    return this.redis.set(key, val, { ttlSec });
  }
  private async safeIncr(key: string) {
    if (!this.redis.enabled) return 0;
    return this.redis.incr(key);
  }

  // ------------ Access Version (invalidate all) ------------
  async getAccessVersion(userId: string) {
    const k = this.accVerKey(userId);
    const v = await this.safeGet(k);
    if (v) return +v;

    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accessVersion: true },
    });
    const av = row?.accessVersion ?? 1;

    await this.safeSet(k, String(av));
    return av;
  }

  async bumpAccessVersion(userId: string) {
    const { accessVersion } = await this.prisma.user.update({
      where: { id: userId },
      data: { accessVersion: { increment: 1 } },
      select: { accessVersion: true },
    });
    await this.safeSet(this.accVerKey(userId), String(accessVersion));
    return accessVersion;
  }

  // ------------ Denylist JTI (revoke single AT) ------------
  async denylistJti(jti: string, expSec: number) {
    if (!this.redis.enabled) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const ttl = Math.max(1, expSec - nowSec + SKEW_SEC);
    await this.safeSetNx(this.denyJtiKey(jti), '1', ttl);
  }
  async isJtiDenied(jti: string) {
    return !!(await this.safeGet(this.denyJtiKey(jti)));
  }

  // ------------ Lock user ------------
  async lockUser(userId: string, seconds: number) {
    await this.safeSetNx(this.lockKey(userId), '1', seconds);
  }
  async isUserLocked(userId: string) {
    return !!(await this.safeGet(this.lockKey(userId)));
  }

  // ------------ Session Version (revoke by session) ------------
  async getSessionVersion(sessionId: string) {
    const cached = await this.safeGet(this.svKey(sessionId));
    if (cached) return +cached;

    const row = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
      select: { accessSv: true, revokedAt: true },
    });
    if (!row || row.revokedAt)
      throw new UnauthorizedException('Session revoked');

    await this.safeSet(this.svKey(sessionId), String(row.accessSv));
    return row.accessSv;
  }

  async bumpSessionVersion(sessionId: string) {
    const { accessSv } = await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { accessSv: { increment: 1 } },
      select: { accessSv: true },
    });
    await this.safeSet(this.svKey(sessionId), String(accessSv));
    return accessSv;
  }
}
