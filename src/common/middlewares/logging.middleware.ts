// src/common/middlewares/logging.middleware.ts

import { Injectable, NestMiddleware } from '@nestjs/common';

const SENSITIVE_KEYS = [
  'password',
  'currentPassword',
  'newPassword',
  'email', // nếu muốn che email trong log
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'code',
  'otp',
  'totp',
  'secret',
  'cookie',
];

function maskValue(key: string, val: any) {
  if (val == null) return val;
  // che toàn bộ string dài (token) hoặc các key nhạy cảm
  if (SENSITIVE_KEYS.includes(key)) return '[REDACTED]';
  if (typeof val === 'string' && val.length > 128) return '[REDACTED]';
  return val;
}

function maskObj(obj: any, depth = 0): any {
  if (!obj || typeof obj !== 'object' || depth > 4) return obj;
  if (Array.isArray(obj)) return obj.map((v) => maskObj(v, depth + 1));
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'object') out[k] = maskObj(v, depth + 1);
    else out[k] = maskValue(k.toLowerCase(), v);
  }
  return out;
}

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  use(req: any, _res: any, next: () => void) {
    try {
      const safeBody = maskObj(req.body || {});
      const safeQuery = maskObj(req.query || {});
      const rawHeaders = req.headers || {};
      const safeHeaders = {
        ...maskObj(rawHeaders),
        authorization: rawHeaders['authorization'] ? '[REDACTED]' : undefined,
        cookie: rawHeaders['cookie'] ? '[REDACTED]' : undefined,
      };

      // Dùng logger chuẩn nếu có (pino/winston). Ở đây demo console:
      console.log(
        JSON.stringify({
          msg: 'HTTP_REQUEST',
          method: req.method,
          url: req.originalUrl ?? req.url,
          ip: req.ip ?? req.headers['x-forwarded-for'],
          headers: safeHeaders,
          body: safeBody,
          query: safeQuery,
        }),
      );
    } catch {
      /* ignore */
    }
    next();
  }
}
