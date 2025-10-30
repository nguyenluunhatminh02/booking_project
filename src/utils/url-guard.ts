const ALLOWED_REDIRECTS = (process.env.PAYMENT_RETURN_ALLOWLIST || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean); // ví dụ: https://app.example.com,https://beta.example.com

export function safeReturnUrl(u?: string | null) {
  if (!u) return undefined;
  try {
    const url = new URL(u);
    if (ALLOWED_REDIRECTS.some((prefix) => u.startsWith(prefix)))
      return url.toString();
  } catch {
    /* empty */
  }
  return undefined;
}
