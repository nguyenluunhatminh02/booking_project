// src/auth/cookie-options.ts
import { CookieOptions } from 'express';

export const REFRESH_COOKIE_NAME = 'rt';
export const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax', // 'strict' nếu SPA không cần cross-site
  path: '/auth', // chỉ gửi cho các route auth
  maxAge: 30 * 24 * 3600 * 1000, // sync với refresh TTL
  // domain: '.yourdomain.com',   // nếu dùng subdomain
  // signed: true,
};
