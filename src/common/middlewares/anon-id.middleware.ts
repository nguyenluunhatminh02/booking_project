import { randomUUID } from 'crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';

@Injectable()
export class AnonIdMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    const name = 'aid';
    const fromCookie = req.cookies?.[name];

    if (!fromCookie) {
      const id = randomUUID();
      // httpOnly=false để client/SSR có thể đọc nếu cần; server vẫn đọc được từ req.cookies
      res.cookie(name, id, {
        maxAge: 180 * 24 * 3600 * 1000, // 180 ngày
        sameSite: 'lax',
        path: '/',
        httpOnly: false,
      });
      req.aid = id;
    } else {
      req.aid = String(fromCookie);
    }
    next();
  }
}
