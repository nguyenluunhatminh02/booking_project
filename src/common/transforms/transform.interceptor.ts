import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request, Response } from 'express';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  meta: {
    timestamp: string;
    path: string;
    method: string;
    statusCode: number;
    requestId?: string;
    pagination?: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  };
}

interface TransformOptions {
  skipSanitization?: boolean;
  customSensitiveFields?: string[];
  excludePaths?: string[];
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  private readonly sensitiveFields = new Set([
    'password',
    'secret',
    'token',
    'refreshtoken',
    'totpsecret',
    'recoverykey',
    'privatekey',
    'apikey',
    'hash',
    'salt',
  ]);

  private readonly skipPaths = new Set(['/health', '/metrics', '/favicon.ico']);

  constructor(private readonly options: TransformOptions = {}) {
    if (options.customSensitiveFields) {
      options.customSensitiveFields.forEach((field) =>
        this.sensitiveFields.add(field.toLowerCase()),
      );
    }

    if (options.excludePaths) {
      options.excludePaths.forEach((path) => this.skipPaths.add(path));
    }
  }

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Skip transformation for certain paths
    if (this.shouldSkipTransformation(request.path)) {
      return next.handle();
    }

    return next
      .handle()
      .pipe(map((data) => this.transformResponse(data, request, response)));
  }

  private transformResponse(
    data: any,
    request: Request,
    response: Response,
  ): ApiResponse {
    const baseMeta = {
      timestamp: new Date().toISOString(),
      path: request.path,
      method: request.method,
      statusCode: response.statusCode,
      requestId: this.extractRequestId(request),
    };

    const baseResponse: ApiResponse = {
      success: response.statusCode < 400,
      meta: baseMeta,
    };

    // Handle null/undefined early
    if (data == null) {
      return { ...baseResponse, data: null };
    }

    // Handle string responses
    if (typeof data === 'string') {
      return { ...baseResponse, message: data };
    }

    // Handle primitive types
    if (typeof data !== 'object') {
      return { ...baseResponse, data };
    }

    // Handle paginated responses
    if (this.isPaginatedResponse(data)) {
      return this.handlePaginatedResponse(baseResponse, data);
    }

    // Handle array responses
    if (Array.isArray(data)) {
      return this.handleArrayResponse(baseResponse, data);
    }

    // Handle wrapped responses
    if ('data' in data) {
      return {
        ...baseResponse,
        data: this.sanitizeData(data.data),
        message: data.message,
      };
    }

    // Default case - single object
    return {
      ...baseResponse,
      data: this.sanitizeData(data),
    };
  }

  private extractRequestId(request: Request): string | undefined {
    return (
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      request?.id?.toString() || (request.headers['x-request-id'] as string)
    );
  }

  private isPaginatedResponse(data: any): boolean {
    return data?.items && Array.isArray(data.items) && data?.meta;
  }

  private handlePaginatedResponse(
    baseResponse: ApiResponse,
    data: any,
  ): ApiResponse {
    const { page, limit, total } = data.meta;
    const totalPages = Math.ceil(total / limit);

    return {
      ...baseResponse,
      data: this.sanitizeData(data.items),
      meta: {
        ...baseResponse.meta,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
    };
  }

  private handleArrayResponse(
    baseResponse: ApiResponse,
    data: any[],
  ): ApiResponse {
    return {
      ...baseResponse,
      data: this.sanitizeData(data),
      meta: {
        ...baseResponse.meta,
        pagination: {
          page: 1,
          limit: data.length,
          total: data.length,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      },
    };
  }

  private sanitizeData(data: any): any {
    if (this.options.skipSanitization) {
      return data;
    }

    return this.deepCleanObject(data, new WeakSet());
  }

  private deepCleanObject(obj: any, seen: WeakSet<object>): any {
    // Handle primitives
    if (obj == null || typeof obj !== 'object') {
      return obj;
    }

    // Handle circular references
    if (seen.has(obj)) {
      return '[Circular]';
    }

    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepCleanObject(item, seen));
    }

    // Handle dates
    if (obj instanceof Date) {
      return obj;
    }

    // Mark as seen for circular reference detection
    seen.add(obj);

    const cleaned: any = {};

    for (const [key, value] of Object.entries(obj)) {
      // Skip sensitive fields
      if (this.isSensitiveField(key)) {
        continue;
      }

      const cleanedValue = this.deepCleanObject(value, seen);

      // Skip empty objects/arrays
      if (this.isEmptyValue(cleanedValue)) {
        continue;
      }

      cleaned[key] = cleanedValue;
    }

    // Remove from seen set to allow reuse in other branches
    seen.delete(obj);

    return cleaned;
  }

  private isSensitiveField(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return (
      this.sensitiveFields.has(lowerKey) ||
      Array.from(this.sensitiveFields).some((field) => lowerKey.includes(field))
    );
  }

  private isEmptyValue(value: any): boolean {
    if (value == null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
  }

  private shouldSkipTransformation(path: string): boolean {
    return this.skipPaths.has(path);
  }
}
