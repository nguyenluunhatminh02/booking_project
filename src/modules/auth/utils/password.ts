import * as bcrypt from 'bcrypt';
import { createHash, timingSafeEqual } from 'crypto';

// ---------- Password ----------
export async function hashPassword(pw: string) {
  const saltRounds = +(process.env.BCRYPT_ROUNDS || 12); // config
  return await bcrypt.hash(pw, saltRounds);
}

export async function verifyPassword(pw: string, hash: string) {
  return await bcrypt.compare(pw, hash);
}

// ---------- Refresh token part ----------
export function hashRefreshPart(part: string): string {
  // SHA-256 + hex/base64
  return createHash('sha256').update(part).digest('base64url');
}

export function verifyRefreshPart(part: string, hash: string): boolean {
  const digest = hashRefreshPart(part);
  // So sánh hằng thời gian để chống timing attack
  return timingSafeEqual(Buffer.from(digest), Buffer.from(hash));
}

// timingSafeEqual helper
