import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Logger } from 'nestjs-pino';

const SENSITIVE_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'pwd',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'ssn',
  'secret',
  'creditcard',
  'cardnumber',
  'cvv',
  'otp',
  'cookie',
  'email',
]);

function maskValue(key: string, val: unknown): unknown {
  if (val == null) return val;
  const lk = key?.toLowerCase?.() ?? '';
  if (SENSITIVE_KEYS.has(lk)) return '[REDACTED]';
  if (typeof val === 'string' && val.length > 256) return '[REDACTED]';
  return val;
}

function maskObj(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== 'object' || depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => maskObj(v, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = k.toLowerCase();
    result[k] =
      typeof v === 'object' && v !== null
        ? maskObj(v, depth + 1)
        : maskValue(key, v);
  }
  return result;
}

@Injectable()
export class ErrorInterceptor implements NestInterceptor {
  constructor(private readonly logger: Logger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((err) => {
        // Attempt to extract HTTP request info if present
        let req: any = undefined;
        try {
          req = context.switchToHttp().getRequest();
        } catch {
          req = undefined;
        }

        const meta = {
          method: req?.method ?? null,
          path: req?.originalUrl ?? req?.url ?? null,
          userId: req?.user?.id ?? req?.user?.sub ?? null,
          requestId: req?.id ?? req?.headers?.['x-request-id'] ?? null,
          status: err instanceof HttpException ? err.getStatus() : 500,
          name: err?.name ?? null,
        };

        // Interceptor should only log lightweight metadata to avoid duplicate / noisy logs.
        // The GlobalExceptionFilter will perform the full error formatting and final logging.
        if (process.env.NODE_ENV === 'production') {
          // Production: do not include request body or stack
          this.logger.error(meta, err?.message ?? 'Unhandled error');
        } else {
          // Non-prod: include redacted request details and stack for debugging
          const safeBody = maskObj(req?.body ?? {});
          const safeQuery = maskObj(req?.query ?? {});
          const safeParams = maskObj(req?.params ?? {});
          const safeHeaders = maskObj(req?.headers ?? {});

          this.logger.error(
            {
              ...meta,
              body: safeBody,
              query: safeQuery,
              params: safeParams,
              headers: safeHeaders,
              stack: err?.stack,
            },
            err?.message ?? 'Unhandled error',
          );
        }

        // Do not attempt to mutate the error; forward to exception filters which handle response & (optionally) Sentry capture.
        return throwError(() => err);
      }),
    );
  }
}
