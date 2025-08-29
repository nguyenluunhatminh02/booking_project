import { Catch, ExceptionFilter, ArgumentsHost } from '@nestjs/common';
import { Response, Request } from 'express';
import { AppException } from './app.exception';
import { randomUUID } from 'crypto';

@Catch(AppException)
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: AppException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    // correlationId có thể lấy từ middleware context
    const correlationId = (req as any).correlationId ?? randomUUID();

    const problem = {
      ...exception.problem,
      instance: req.originalUrl,
      correlationId,
    };

    if (exception.problem.retryAfterSec) {
      res.setHeader('Retry-After', String(exception.problem.retryAfterSec));
    }

    res.status(exception.getStatus()).json(problem);
  }
}
