import { HttpException, HttpStatus } from '@nestjs/common';

export class TooManyRequestsException extends HttpException {
  constructor(message = 'Too many requests', retryAfterSec?: number) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);

    // Nếu muốn set header Retry-After trong response
    if (retryAfterSec) {
      (this as any).response = {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message,
        retryAfter: retryAfterSec,
      };
    }
  }
}
