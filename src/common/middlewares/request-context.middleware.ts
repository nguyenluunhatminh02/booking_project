// src/common/middlewares/request-context.middleware.ts

import { Injectable, NestMiddleware } from '@nestjs/common';

export type NetCtx = { ip?: string; ua?: string; deviceFp?: string };

declare module 'http' {
  interface IncomingMessage {
    ctx?: NetCtx;
  }
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: any, _res: any, next: () => void) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      'unknown';

    const ua = (req.headers['user-agent'] as string) || undefined;
    const deviceFp = (req.headers['x-device-fp'] as string) || undefined;

    req.ctx = { ip, ua, deviceFp };
    next();
  }
}
