import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/common/redis.service';

const NS = 'v1:auth'; // namespace để dễ migrate key format
const SKEW_SEC = 60; // bù lệch clock ~60s

@Injectable()
export class TokenStateService {
  constructor(private redis: RedisService) {}

  // ------------ Key builders ------------
  private accVerKey = (u: string) => `${NS}:accver:${u}`;
  private denyJtiKey = (kid: string | undefined, j: string) =>
    kid ? `${NS}:deny:jti:${kid}:${j}` : `${NS}:deny:jti:${j}`;
  private lockKey = (u: string) => `${NS}:lock:user:${u}`;

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
  /**
   * Lấy accessVersion hiện tại của user; nếu miss cache ⇒ init = 1.
   */
  async getAccessVersion(userId: string) {
    const k = this.accVerKey(userId);
    const v = await this.safeGet(k);
    if (v) return +v;

    // init = 1 (idempotent); có thể sync sang DB nếu muốn "source of truth"
    await this.safeSet(k, '1');
    return 1;
  }

  /**
   * Tăng version (atomic) ⇒ invalidate toàn bộ access token av cũ.
   */
  async bumpAccessVersion(userId: string) {
    const v = await this.safeIncr(this.accVerKey(userId));
    return v || 1;
  }

  // ------------ Denylist JTI (invalidate token đơn lẻ) ------------
  /**
   * Đưa jti vào denylist tới đúng lúc token hết hạn.
   * @param jti   JWT ID
   * @param expSec UNIX seconds của exp trong token
   * @param kid   (tuỳ chọn) nếu bạn có xoay khoá ký JWT theo kid
   */
  async denylistJti(jti: string, expSec: number, kid?: string) {
    if (!this.redis.enabled) return;

    const nowSec = Math.floor(Date.now() / 1000);
    const ttl = Math.max(1, expSec - nowSec + SKEW_SEC);
    const key = this.denyJtiKey(kid, jti);

    // NX để idempotent và tránh reset TTL ngoài ý muốn khi retry
    await this.safeSetNx(key, '1', ttl);
  }

  async isJtiDenied(jti: string, kid?: string) {
    const key = this.denyJtiKey(kid, jti);
    return !!(await this.safeGet(key));
  }

  // ------------ Lock user (tạm khoá tài khoản) ------------
  /**
   * Khoá user trong N giây (idempotent, không reset TTL khi gọi lại).
   */
  async lockUser(userId: string, seconds: number) {
    await this.safeSetNx(this.lockKey(userId), '1', seconds);
  }

  async isUserLocked(userId: string) {
    return !!(await this.safeGet(this.lockKey(userId)));
  }
}
