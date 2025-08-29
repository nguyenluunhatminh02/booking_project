import { randomBytes } from 'crypto';

const SEP = '.'; // một nơi duy nhất quyết định separator
const MIN_TOKEN_BYTES = 32; // 256-bit tối thiểu
const DEFAULT_TOKEN_BYTES = 48; // 384-bit như bạn đang dùng
const MAX_TTL_SEC = 60 * 60 * 24 * 365 * 5; // 5 năm, tuỳ app mà chỉnh

export type RefreshTokenParts = { sessionId: string; tokenPart: string };

/** Tách "sessionId.tokenPart"; trả null nếu định dạng không hợp lệ. */
export function splitRefreshToken(token: string): RefreshTokenParts | null {
  if (!token) return null;
  const i = token.indexOf(SEP);
  if (i <= 0 || i === token.length - 1) return null; // phải có 2 phần non-empty
  const sessionId = token.slice(0, i);
  const tokenPart = token.slice(i + 1);
  return { sessionId, tokenPart };
}

/** Chỉ kiểm format, không parse. */
export function isRefreshTokenFormat(token: string): boolean {
  const parts = splitRefreshToken(token);
  return !!parts;
}

/** Ghép lại token "sessionId.tokenPart". */
export function buildRefreshToken(
  sessionId: string,
  tokenPart: string,
): string {
  if (!sessionId || !tokenPart) throw new Error('Invalid parts');
  if (sessionId.includes(SEP) || tokenPart.includes(SEP)) {
    throw new Error('Parts must not contain separator');
  }
  return `${sessionId}${SEP}${tokenPart}`;
}

/** Sinh chuỗi base64url ngẫu nhiên (mặc định 48 bytes = 384-bit). */
export function genTokenPart(bytes = DEFAULT_TOKEN_BYTES): string {
  if (!Number.isInteger(bytes) || bytes < MIN_TOKEN_BYTES) {
    throw new Error(`bytes must be >= ${MIN_TOKEN_BYTES}`);
  }
  return randomBytes(bytes).toString('base64url');
}

/**
 * Parse duration → seconds.
 * Hỗ trợ:
 *  - Đơn: "45s", "15m", "2h", "7d" (hoặc "60" = 60s)
 *  - Ghép: "1h30m", "2h15m10s", "3d12h", v.v.
 * Không phân biệt hoa/thường. Trả `def` nếu không parse được.
 */
export function parseDurationToSec(s: string | undefined, def: number): number {
  if (!s) return def;

  const trimmed = s.trim();
  if (!trimmed) return def;

  // Nếu chỉ là số → coi như giây
  if (/^\d+$/.test(trimmed)) {
    const sec = Number(trimmed);
    return clampTtlOrDef(sec, def);
  }

  // Hỗ trợ chuỗi ghép: 1h30m10s, 2d, 45m, v.v.
  const rx = /(\d+)\s*([smhd])/gi;
  let match: RegExpExecArray | null;
  let total = 0;
  let matchedAny = false;

  while ((match = rx.exec(trimmed))) {
    matchedAny = true;
    const n = Number(match[1]);
    const unit = match[2].toLowerCase();
    const mul =
      unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
    total += n * mul;

    // Chặn overflow về sớm
    if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) {
      return def;
    }
  }

  if (!matchedAny) return def;
  return clampTtlOrDef(total, def);
}

/** Giới hạn TTL hợp lệ; nếu không hợp lệ, trả `def`. */
function clampTtlOrDef(sec: number, def: number): number {
  if (!Number.isFinite(sec) || sec <= 0) return def;
  if (sec > MAX_TTL_SEC) return MAX_TTL_SEC; // hoặc def, tuỳ policy
  return Math.floor(sec);
}
