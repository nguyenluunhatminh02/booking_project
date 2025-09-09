import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable()
export class ErrorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((err) => {
        // Log error for monitoring
        console.error('API Error:', {
          path: context.switchToHttp().getRequest().path,
          error: err.message,
          stack: err.stack,
        });

        return throwError(() => err);
      }),
    );
  }
}
