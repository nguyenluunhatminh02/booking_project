// src/common/middlewares/xss.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { filterXSS } from 'xss'; // ⬅️ thay vì import xss from 'xss'

@Injectable()
export class XssMiddleware implements NestMiddleware {
  private readonly options = {
    whiteList: {},
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script'],
  };

  use(req: Request, _res: Response, next: NextFunction) {
    const ct = (req.headers['content-type'] || '').toLowerCase();
    const isUpload =
      ct.includes('multipart/form-data') || ct.includes('octet-stream');
    if (isUpload) return next();

    if (req.body && typeof req.body === 'object') {
      req.body = this.cloneSanitize(req.body);
    }
    if (req.query) this.sanitizeInPlace(req.query as any);
    if (req.params) this.sanitizeInPlace(req.params as any);

    next();
  }

  private cloneSanitize(val: any): any {
    if (Array.isArray(val)) return val.map((v) => this.cloneSanitize(v));
    if (val && typeof val === 'object') {
      const out: any = {};
      for (const [k, v] of Object.entries(val)) out[k] = this.cloneSanitize(v);
      return out;
    }
    if (typeof val === 'string') return filterXSS(val, this.options); // ⬅️
    return val;
  }

  private sanitizeInPlace(obj: any) {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (typeof v === 'string') {
        obj[key] = filterXSS(v, this.options); // ⬅️
      } else if (Array.isArray(v)) {
        obj[key] = v.map((item) =>
          typeof item === 'string'
            ? filterXSS(item, this.options) // ⬅️
            : this.cloneSanitize(item),
        );
      } else if (v && typeof v === 'object') {
        this.sanitizeInPlace(v);
      }
    }
  }
}
