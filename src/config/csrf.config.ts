// src/config/csrf.config.ts
import type { CookieOptions } from 'express';

export const CSRF_CONFIG = {
  cookie: {
    key: '__Host-csrf',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  } as CookieOptions & { key: string },
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'] as const,
  ignoredPaths: [
    // thường KHÔNG cần bỏ qua các GET này vì đã ignoreMethods
    '/api/health',
    '/api/metrics',
    '/api/docs',
    '/api/auth/csrf-token', // client gọi lấy token
  ],
  enabled:
    (process.env.CSRF_ENABLED ?? '1') === '1' &&
    process.env.NODE_ENV !== 'test', // 👈 tắt khi test
  headerNames: ['x-csrf-token', 'x-xsrf-token'], // client gửi token trong header nào
} as const;
