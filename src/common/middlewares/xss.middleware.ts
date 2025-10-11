// src/common/middlewares/xss.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { filterXSS } from 'xss';

type Sanitizable =
  | string
  | number
  | boolean
  | null
  | undefined
  | SanitizableObject
  | Sanitizable[];
type SanitizableObject = { [key: string]: Sanitizable };

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

@Injectable()
export class XssMiddleware implements NestMiddleware {
  private readonly options = {
    whiteList: {},
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script'],
  };

  use(req: Request, _res: Response, next: NextFunction) {
    const contentType = (req.headers['content-type'] || '').toLowerCase();
    const isUpload =
      contentType.includes('multipart/form-data') ||
      contentType.includes('octet-stream');
    if (isUpload) return next();

    if (req.body && typeof req.body === 'object') {
      req.body = this.cloneSanitize(req.body);
    }
    if (req.query) this.sanitizeInPlace(req.query as Record<string, unknown>);
    if (req.params) this.sanitizeInPlace(req.params as Record<string, unknown>);

    next();
  }

  private cloneSanitize<T extends Sanitizable>(value: T): T {
    if (Array.isArray(value)) {
      return value.map((item) => this.cloneSanitize(item)) as T;
    }

    if (isObject(value)) {
      const result: Record<string, Sanitizable> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = this.cloneSanitize(val as Sanitizable);
      }
      return result as T;
    }

    if (typeof value === 'string') {
      return filterXSS(value, this.options) as T;
    }

    return value;
  }

  private sanitizeInPlace(target: Record<string, unknown>) {
    for (const key of Object.keys(target)) {
      const value = target[key];
      if (typeof value === 'string') {
        target[key] = filterXSS(value, this.options);
      } else if (Array.isArray(value)) {
        target[key] = value.map((item) =>
          typeof item === 'string'
            ? filterXSS(item, this.options)
            : this.cloneSanitize(item as Sanitizable),
        );
      } else if (isObject(value)) {
        this.sanitizeInPlace(value);
      }
    }
  }
}
