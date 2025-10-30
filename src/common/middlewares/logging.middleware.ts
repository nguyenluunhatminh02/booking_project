// src/common/middlewares/logging.middleware.ts

import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

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

function maskValue(key: string, val: unknown): unknown {
  if (val == null) return val;
  if (SENSITIVE_KEYS.includes(key)) return '[REDACTED]';
  if (typeof val === 'string' && val.length > 128) return '[REDACTED]';
  return val;
}

function maskObj(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== 'object' || depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => maskObj(v, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    result[k] =
      typeof v === 'object' && v !== null
        ? maskObj(v, depth + 1)
        : maskValue(k.toLowerCase(), v);
  }
  return result;
}

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  constructor(private readonly logger: PinoLogger) {}

  use(req: Request, _res: Response, next: NextFunction) {
    try {
      const safeBody = maskObj(req.body ?? {});
      const safeQuery = maskObj(req.query ?? {});
      const rawHeaders = req.headers ?? {};
      const maskedHeaders = maskObj(rawHeaders) as Record<string, unknown>;
      const safeHeaders: Record<string, unknown> = {
        ...maskedHeaders,
        authorization: rawHeaders.authorization ? '[REDACTED]' : undefined,
        cookie: rawHeaders.cookie ? '[REDACTED]' : undefined,
      };

      // Use structured logger (pino) so logs are consistent with LoggerModule
      this.logger.info(
        {
          msg: 'HTTP_REQUEST',
          method: req.method,
          url: req.originalUrl ?? req.url,
          ip: req.ip ?? req.headers['x-forwarded-for'],
          headers: safeHeaders,
          body: safeBody,
          query: safeQuery,
        },
        'HTTP_REQUEST',
      );
    } catch {
      /* ignore */
    }
    next();
  }
}
