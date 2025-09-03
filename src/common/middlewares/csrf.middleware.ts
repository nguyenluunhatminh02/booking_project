import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as csurf from 'csurf';
import { CSRF_CONFIG } from '../../config/csrf.config';

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private csrfProtection = csurf({
    cookie: CSRF_CONFIG.cookie,
    ignoreMethods: [...CSRF_CONFIG.ignoredMethods],
  });

  use(req: Request, res: Response, next: NextFunction) {
    if (
      CSRF_CONFIG.ignoredPaths.includes(
        req.path as
          | '/api/auth/login'
          | '/api/auth/register'
          | '/api/health'
          | '/api/metrics',
      )
    ) {
      return next();
    }

    this.csrfProtection(req, res, next);
  }
}
