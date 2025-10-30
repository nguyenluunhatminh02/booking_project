// src/modules/invoice/qr.util.ts
import { createHmac, timingSafeEqual } from 'crypto';

const DEFAULT_BASE = process.env.PUBLIC_APP_URL || 'https://app.example.com';
const DEFAULT_SECRET = process.env.PUBLIC_QR_SECRET || 'change-me';
const DEFAULT_TTL = Number(process.env.PUBLIC_QR_TTL_SECONDS || 900); // 15 phút

function sign(bookingId: string, ts: number, secret: string) {
  return createHmac('sha256', secret)
    .update(`${bookingId}.${ts}`)
    .digest('hex');
}

/** Tạo URL ngắn để encode vào QR, có chữ ký và timestamp */
export function buildSignedQrUrl(bookingId: string, base = DEFAULT_BASE) {
  const secret = DEFAULT_SECRET;
  const ts = Math.floor(Date.now() / 1000);
  const sig = sign(bookingId, ts, secret);

  // Dùng path ngắn /i/:id cho QR gọn
  const url = new URL(`/i/${bookingId}`, base);
  url.searchParams.set('ts', String(ts));
  url.searchParams.set('sig', sig);
  return url.toString();
}

/** Verify ts+sig với TTL. Trả về { ok: true } nếu hợp lệ. */
export function verifySignedQr(
  bookingId: string,
  tsStr: string | undefined,
  sig: string | undefined,
  {
    secret = DEFAULT_SECRET,
    ttlSeconds = DEFAULT_TTL,
  }: { secret?: string; ttlSeconds?: number } = {},
): { ok: true } | { ok: false; reason: string } {
  if (!tsStr || !sig) return { ok: false, reason: 'missing_params' };

  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_ts' };

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > ttlSeconds) return { ok: false, reason: 'expired' };

  const expected = sign(bookingId, ts, secret);

  // So sánh an toàn thời gian (constant-time) nếu có thể
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(sig, 'hex');
    if (a.length !== b.length) return { ok: false, reason: 'mismatch' };
    if (!timingSafeEqual(a, b)) return { ok: false, reason: 'mismatch' };
  } catch {
    // fallback (ít an toàn hơn, chỉ trong trường hợp sig không phải hex)
    if (expected !== sig) return { ok: false, reason: 'mismatch' };
  }

  return { ok: true };
}
