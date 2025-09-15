// src/common/filters/global-exception.filter.ts

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { TokenExpiredError, JsonWebTokenError } from 'jsonwebtoken';
import { AppException } from '../errors/app.exception';

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
    field?: string;
    timestamp: string;
    path: string;
    method: string;
    requestId?: string;
    statusCode: number;
  };
  meta: {
    timestamp: string;
    path: string;
    method: string;
    requestId?: string;
    statusCode: number;
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('GlobalExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Nếu là AppException -> map sang ErrorResponse + set headers
    if (exception instanceof AppException) {
      const errorResponse = this.handleAppException(
        exception,
        request,
        response,
      );
      response.status(errorResponse.error.statusCode).json(errorResponse);
      return;
    }

    const errorResponse = this.buildErrorResponse(exception, request);

    // Log error with appropriate level
    this.logError(exception, request, errorResponse);

    // Send response
    response.status(errorResponse.error.statusCode).json(errorResponse);
  }

  private handleAppException(
    exception: AppException,
    request: Request,
    response: Response,
  ): ErrorResponse {
    const timestamp = new Date().toISOString();
    const path = request.path;
    const method = request.method;
    const requestId =
      (request as any).id || (request.headers['x-request-id'] as string);

    // Set headers nếu có
    const prob = exception.problem;
    if (prob.retryAfterSec != null) {
      response.setHeader('Retry-After', String(prob.retryAfterSec));
    }
    if (prob.headers && typeof prob.headers === 'object') {
      for (const [k, v] of Object.entries(prob.headers)) {
        response.setHeader(k, String(v));
      }
    }

    const status = exception.getStatus();
    // Ưu tiên detail làm message, fallback title
    const message = prob.detail || prob.title;

    return {
      success: false,
      error: {
        code: prob.code, // ⬅️ giữ code ổn định cho client
        message,
        details: prob.fieldErrors
          ? { fieldErrors: prob.fieldErrors }
          : undefined,
        statusCode: status,
        timestamp,
        path,
        method,
        requestId,
      },
      meta: {
        timestamp,
        path,
        method,
        requestId,
        statusCode: status,
      },
    };
  }

  private buildErrorResponse(
    exception: unknown,
    request: Request,
  ): ErrorResponse {
    const timestamp = new Date().toISOString();
    const path = request.path;
    const method = request.method;
    const requestId = request.id || (request.headers['x-request-id'] as string);

    const baseMeta = {
      timestamp,
      path,
      method,
      requestId,
    };

    // Handle different exception types
    if (exception instanceof HttpException) {
      return this.handleHttpException(exception, baseMeta);
    }

    if (exception instanceof PrismaClientKnownRequestError) {
      return this.handlePrismaError(exception, baseMeta);
    }

    if (exception instanceof TokenExpiredError) {
      return this.handleJwtError(exception, baseMeta, 'TOKEN_EXPIRED');
    }

    if (exception instanceof JsonWebTokenError) {
      return this.handleJwtError(exception, baseMeta, 'INVALID_TOKEN');
    }

    if (exception instanceof Error) {
      return this.handleGenericError(exception, baseMeta);
    }

    // Unknown exception type
    return this.handleUnknownError(exception, baseMeta);
  }

  private handleHttpException(
    exception: HttpException,
    baseMeta: any,
  ): ErrorResponse {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    let errorCode = 'HTTP_EXCEPTION';
    let message = exception.message;
    let details: any = null;

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const responseObj = exceptionResponse as any;
      errorCode = responseObj.code || this.getErrorCodeFromStatus(status);
      message = responseObj.message || message;
      details = responseObj.details || responseObj.errors || null;
    }

    return {
      success: false,
      error: {
        code: errorCode,
        message,
        details,
        statusCode: status,
        timestamp: baseMeta.timestamp,
        path: baseMeta.path,
        method: baseMeta.method,
        requestId: baseMeta.requestId,
      },
      meta: {
        ...baseMeta,
        statusCode: status,
      },
    };
  }

  private handlePrismaError(
    exception: PrismaClientKnownRequestError,
    baseMeta: any,
  ): ErrorResponse {
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'DATABASE_ERROR';
    let message = 'Database operation failed';
    let field: string | undefined;

    switch (exception.code) {
      case 'P2002':
        status = HttpStatus.CONFLICT;
        code = 'DUPLICATE_ENTRY';
        message = 'Resource already exists';
        field = (exception.meta?.target as string[])?.[0];
        break;

      case 'P2025':
        status = HttpStatus.NOT_FOUND;
        code = 'NOT_FOUND';
        message = 'Resource not found';
        break;

      case 'P2003':
        status = HttpStatus.BAD_REQUEST;
        code = 'INVALID_RELATION';
        message = 'Related resource not found';
        field = exception.meta?.field_name as string;
        break;

      case 'P2014':
        status = HttpStatus.BAD_REQUEST;
        code = 'REQUIRED_RELATION_MISSING';
        message = 'Required relation is missing';
        break;

      case 'P2000':
        status = HttpStatus.BAD_REQUEST;
        code = 'VALUE_TOO_LONG';
        message = 'The provided value is too long';
        break;

      case 'P2001':
        status = HttpStatus.NOT_FOUND;
        code = 'RECORD_NOT_FOUND';
        message = 'Record does not exist';
        break;
    }

    return {
      success: false,
      error: {
        code,
        message,
        field,
        statusCode: status,
        timestamp: baseMeta.timestamp,
        path: baseMeta.path,
        method: baseMeta.method,
        requestId: baseMeta.requestId,
        details:
          process.env.NODE_ENV === 'development'
            ? {
                prismaCode: exception.code,
                meta: exception.meta,
              }
            : undefined,
      },
      meta: {
        ...baseMeta,
        statusCode: status,
      },
    };
  }

  private handleJwtError(
    exception: Error,
    baseMeta: any,
    code: string,
  ): ErrorResponse {
    const status = HttpStatus.UNAUTHORIZED;

    return {
      success: false,
      error: {
        code,
        message: 'Authentication failed',
        statusCode: status,
        timestamp: baseMeta.timestamp,
        path: baseMeta.path,
        method: baseMeta.method,
        requestId: baseMeta.requestId,
        details:
          process.env.NODE_ENV === 'development'
            ? exception.message
            : undefined,
      },
      meta: {
        ...baseMeta,
        statusCode: status,
      },
    };
  }

  private handleGenericError(exception: Error, baseMeta: any): ErrorResponse {
    const status = HttpStatus.INTERNAL_SERVER_ERROR;

    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message:
          process.env.NODE_ENV === 'production'
            ? 'An unexpected error occurred'
            : exception.message,
        statusCode: status,
        timestamp: baseMeta.timestamp,
        path: baseMeta.path,
        method: baseMeta.method,
        requestId: baseMeta.requestId,
        details:
          process.env.NODE_ENV === 'development'
            ? {
                stack: exception.stack,
              }
            : undefined,
      },
      meta: {
        ...baseMeta,
        statusCode: status,
      },
    };
  }

  private handleUnknownError(exception: unknown, baseMeta: any): ErrorResponse {
    const status = HttpStatus.INTERNAL_SERVER_ERROR;

    return {
      success: false,
      error: {
        code: 'UNKNOWN_ERROR',
        message: 'An unexpected error occurred',
        statusCode: status,
        timestamp: baseMeta.timestamp,
        path: baseMeta.path,
        method: baseMeta.method,
        requestId: baseMeta.requestId,
      },
      meta: {
        ...baseMeta,
        statusCode: status,
      },
    };
  }

  private getErrorCodeFromStatus(status: number): string {
    const statusCodeMap: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
    };

    return statusCodeMap[status] || 'HTTP_ERROR';
  }

  private logError(
    exception: unknown,
    request: Request,
    errorResponse: ErrorResponse,
  ): void {
    const { error } = errorResponse;
    const logContext = {
      requestId: error.requestId,
      path: error.path,
      method: error.method,
      statusCode: error.statusCode,
      userAgent: request.headers['user-agent'],
      ip: request.ip,
      userId: (request as any).user?.id,
    };

    if (error.statusCode >= 500) {
      // Server errors - log as error with full details
      this.logger.error(
        `${error.code}: ${error.message}`,
        exception instanceof Error ? exception.stack : undefined,
        logContext,
      );
    } else if (error.statusCode >= 400) {
      // Client errors - log as warning
      this.logger.warn(`${error.code}: ${error.message}`, logContext);
    } else {
      // Other cases - log as debug
      this.logger.debug(`${error.code}: ${error.message}`, logContext);
    }
  }
}
