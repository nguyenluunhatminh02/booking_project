// src/common/middlewares/csrf.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as csurf from 'csurf';
import { CSRF_CONFIG } from '../../config/csrf.config';

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private csrfProtection = csurf({
    cookie: CSRF_CONFIG.cookie,
    ignoreMethods: [...CSRF_CONFIG.ignoredMethods],
    // value: (req) => (req.headers['x-csrf-token'] as string) || (req.headers['x-xsrf-token'] as string),
  });

  private isIgnored(req: Request) {
    const url = req.originalUrl || req.url || req.path;
    return CSRF_CONFIG.ignoredPaths.some((p) => url.startsWith(p));
  }

  use(req: Request, res: Response, next: NextFunction) {
    if (this.isIgnored(req)) return next();
    this.csrfProtection(req, res, next);
  }
}
