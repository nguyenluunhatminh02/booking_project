// src/common/middlewares/csrf.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CSRF_CONFIG } from '../../config/csrf.config';

// dùng require để tránh rắc rối ESM/CJS khi test
// eslint-disable-next-line @typescript-eslint/no-require-imports
const csurf = require('csurf');

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly enabled = CSRF_CONFIG.enabled;

  private readonly csrfProtection = this.enabled
    ? csurf({
        cookie: CSRF_CONFIG.cookie,
        ignoreMethods: [...CSRF_CONFIG.ignoredMethods],
        value: (req: Request) => {
          for (const h of CSRF_CONFIG.headerNames) {
            const v = req.headers[h] as string | undefined;
            if (v) return v;
          }
          // fallback nếu bạn gửi _csrf trong body (form)
          return (req.body?._csrf as string) || '';
        },
      })
    : null;

  private isIgnored(req: Request) {
    const url = (req.originalUrl || req.url || '').split('?')[0];
    return CSRF_CONFIG.ignoredPaths.some((p) => url.startsWith(p));
  }

  use(req: Request, res: Response, next: NextFunction) {
    if (!this.enabled || this.isIgnored(req)) return next();
    this.csrfProtection!(req, res, next);
  }
}
