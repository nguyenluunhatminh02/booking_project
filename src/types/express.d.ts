import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    ctx?: { ip?: string; ua?: string; deviceFp?: string; deviceId?: string };
    csrfToken: () => string;
  }
}
