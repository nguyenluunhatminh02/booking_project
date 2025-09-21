import * as crypto from 'crypto';
import { FeatureFlagsService } from './feature-flags.service';

type RolloutPayload = {
  rollout?: number; // 0..100
  salt?: string; // tách không gian hash giữa các flag
  allowUsers?: string[]; // ưu tiên bật
  denyUsers?: string[]; // ưu tiên tắt
  // timeWindow?: { from?: string; to?: string }; // có thể bật nếu cần
  // envs?: { include?: string[] }
};

export function clampPct(x: unknown, def = 100): number {
  const n = Number(x);
  if (!Number.isFinite(n)) return def;
  return Math.max(0, Math.min(100, Math.floor(n)));
}

// Hash ổn định → bucket 0..99
export function bucketOf(input: string): number {
  const h = crypto.createHash('sha256').update(input).digest();
  const n = h.readUInt32BE(0); // 0..2^32-1
  return Math.floor((n / 0x100000000) * 100); // 0..99
}

/** Bật/tắt tổng (không theo user) */
export async function isEnabled(
  ff: FeatureFlagsService,
  key: string,
): Promise<boolean> {
  const rec = await ff.get(key);
  return !!rec.enabled;
}

/** Rollout theo userId với allow/deny/percent */
export async function isEnabledForUser(
  ff: FeatureFlagsService,
  key: string,
  userId?: string | null,
): Promise<boolean> {
  const { enabled, payload } = await ff.get(key);
  if (!enabled) return false;

  const p: RolloutPayload = (payload ?? {}) as RolloutPayload;

  // deny thắng
  if (userId && Array.isArray(p.denyUsers) && p.denyUsers.includes(userId))
    return false;
  // allow kế
  if (userId && Array.isArray(p.allowUsers) && p.allowUsers.includes(userId))
    return true;

  const rollout = clampPct(p.rollout, 100);
  const salt = String(p.salt ?? key);

  // ẩn danh chỉ bật khi 100%
  if (!userId) return rollout >= 100;

  return bucketOf(`${salt}:${userId}`) < rollout;
}

/** Helper debug: trả quyết định + lý do (để log/metrics) */
export type DecisionReason =
  | 'disabled'
  | 'deny'
  | 'allow'
  | 'anon_requires_100'
  | 'percent_below'
  | 'percent_above';

export type Decision = {
  on: boolean;
  reason: DecisionReason;
  bucket?: number;
  rollout?: number;
};

export async function decideForUser(
  ff: FeatureFlagsService,
  key: string,
  userId?: string | null,
): Promise<Decision> {
  const { enabled, payload } = await ff.get(key);
  if (!enabled) return { on: false, reason: 'disabled' };

  const p: RolloutPayload = (payload ?? {}) as RolloutPayload;

  if (userId && Array.isArray(p.denyUsers) && p.denyUsers.includes(userId))
    return { on: false, reason: 'deny' };

  if (userId && Array.isArray(p.allowUsers) && p.allowUsers.includes(userId))
    return { on: true, reason: 'allow' };

  const rollout = clampPct(p.rollout, 100);
  const salt = String(p.salt ?? key);

  if (!userId) {
    return rollout >= 100
      ? { on: true, reason: 'percent_above', rollout }
      : { on: false, reason: 'anon_requires_100', rollout };
  }

  const bucket = bucketOf(`${salt}:${userId}`);
  const on = bucket < rollout;
  return {
    on,
    reason: on ? 'percent_above' : 'percent_below',
    bucket,
    rollout,
  };
}
