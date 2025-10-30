import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { Request } from 'express';

// Những đường cần che khỏi log (redact & remove)
const REDACT_PATHS = [
  // Request headers
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  // Body / Query params nhạy cảm
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.token',
  'req.body.accessToken',
  'req.body.refreshToken',
  'req.body.code',
  'req.body.otp',
  'req.body.totp',
  'req.body.secret',
  'req.body.email', // tuỳ policy: che email
  'req.query.token',
  'req.query.code',
  'req.query.email', // tuỳ policy
  // Response headers
  'res.headers["set-cookie"]',
];

// Nâng cấp mức log theo status code
function levelByStatus(res: any, err?: any) {
  if (err || res.statusCode >= 500) return 'error';
  if (res.statusCode >= 400) return 'warn';
  return 'info';
}

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL || 'info',

        // Pretty ở dev (ẩn ở production)
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  translateTime: 'SYS:standard',
                  singleLine: true,
                  messageFormat:
                    '{req.method} {req.url} {res.statusCode} - {responseTime}ms',
                },
              }
            : undefined,

        // Che dữ liệu nhạy cảm
        redact: {
          paths: REDACT_PATHS,
          remove: true,
        },

        // Tự tạo/nhận request-id và set vào response header
        genReqId: (req, res) => {
          const hdr =
            (req.headers['x-request-id'] as string) ||
            (req.headers['x-correlation-id'] as string);
          const id = hdr || randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },

        // Thêm props vào log (IP thực, UA, userId, deviceFp)
        customProps: (req: Request) => {
          const ip =
            (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
            req.ip ||
            (req.socket && (req.socket as any).remoteAddress) ||
            undefined;

          const ua = (req.headers['user-agent'] as string) || undefined;
          const userId = (req as any).user?.id; // sau JWT guard
          const deviceFp = (req as any).ctx?.deviceFp;

          return { ip, ua, userId, deviceFp };
        },

        // Tự chọn mức log theo status
        customLogLevel: (req, res, err) => levelByStatus(res, err),

        // Bỏ qua log cho đường ồn ào
        autoLogging: {
          ignore: (req) =>
            ['/health', '/metrics', '/favicon.ico'].includes(req.url ?? ''),
        },

        // Thêm serializers nếu muốn gọn hơn
        serializers: {
          req(req) {
            // mặc định pino-http đã log gọn; có thể tuỳ biến thêm
            return {
              id: req.id,
              method: req.method,
              url: req.url,
              headers: req.headers, // đã redact theo cấu hình
              remoteAddress: req.socket?.remoteAddress,
            };
          },
          res(res) {
            return {
              statusCode: res.statusCode,
              headers: res.getHeaders ? res.getHeaders() : res.headers,
            };
          },
        },
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
