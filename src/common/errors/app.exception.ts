// src/common/errors/app.exception.ts
import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Mã lỗi nội bộ ổn định để FE/mobile/partner xử lý theo case.
 * Thêm/bớt mã mới tại đây khi mở rộng business.
 */
export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'RESOURCE_LOCKED'
  | 'PRECONDITION_REQUIRED'
  | 'TOO_EARLY'
  | 'PAYLOAD_TOO_LARGE'
  | 'MFA_REQUIRED'
  | 'ACCOUNT_BANNED'
  | 'LEGAL_BLOCKED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'BAD_REQUEST'
  | 'INTERNAL_ERROR';

/**
 * Problem Details (RFC 7807) + extensions cho sản phẩm thực tế.
 * - type:     URL tới trang docs mô tả lỗi (nội bộ), optional
 * - title:    Tóm tắt ngắn gọn
 * - status:   HTTP status code
 * - code:     AppErrorCode (ổn định cho client)
 * - detail:   Mô tả cụ thể cho developer/user
 * - instance: Resource/URL gây lỗi (điền ở filter)
 * - extensions: các field mở rộng như retryAfterSec, fieldErrors...
 */
export interface AppProblem {
  type?: string;
  title: string;
  status: number;
  code: AppErrorCode;
  detail?: string;
  headers?: Record<string, string | number>;
  instance?: string;
  // Extensions (tuỳ case dùng)
  retryAfterSec?: number;
  fieldErrors?: Array<{ field: string; message: string }>;
  banUntil?: string; // ISO string nếu tài khoản bị cấm tới thời điểm nào
  correlationId?: string;
  // Cho phép mở rộng tự do
  [k: string]: any;
}

/**
 * AppException bọc AppProblem để quăng trong toàn app.
 * Sử dụng cùng AppExceptionFilter để:
 * - Set header chuẩn (Retry-After, RateLimit-*, ...)
 * - Đính instance, correlationId
 * - Chuẩn hoá body trả về
 */
export class AppException extends HttpException {
  public readonly problem: AppProblem;

  constructor(problem: AppProblem) {
    super(problem, problem.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    this.problem = problem;
  }

  /**
   * Tạo nhanh AppException từ các tham số hay dùng.
   * Có thể không dùng cũng được – tuỳ style của team.
   */
  static of(
    params: Pick<AppProblem, 'title' | 'code' | 'status'> & Partial<AppProblem>,
  ) {
    const { title, code, status, detail, type, ...rest } = params;
    return new AppException({
      title,
      code,
      status,
      detail,
      type,
      ...rest, // chỉ còn field bổ sung (vd: retryAfterSec, fieldErrors...)
    });
  }
}

/* ============================
 * Factory helpers cho các case thường gặp
 * ============================
 */

export const BadRequest = (detail?: string) =>
  new AppException({
    title: 'Bad request',
    status: 400,
    code: 'BAD_REQUEST',
    detail,
  });

export const Unauthorized = (detail?: string) =>
  new AppException({
    title: 'Unauthorized',
    status: 401,
    code: 'UNAUTHORIZED',
    detail,
  });

export const Forbidden = (detail?: string) =>
  new AppException({
    title: 'Forbidden',
    status: 403,
    code: 'FORBIDDEN',
    detail,
  });

export const NotFound = (detail?: string) =>
  new AppException({
    title: 'Not found',
    status: 404,
    code: 'NOT_FOUND',
    detail,
  });

export const ValidationException = (
  fieldErrors: AppProblem['fieldErrors'],
  detail?: string,
) =>
  new AppException({
    title: 'Validation failed',
    status: 422,
    code: 'VALIDATION_ERROR',
    fieldErrors,
    detail,
  });

export const ConflictException = (detail?: string) =>
  new AppException({
    title: 'Conflict',
    status: 409,
    code: 'CONFLICT',
    detail,
  });

export const ResourceLockedException = (detail?: string) =>
  new AppException({
    title: 'Resource locked',
    status: 423,
    code: 'RESOURCE_LOCKED',
    detail,
  });

export const PreconditionRequiredException = (detail?: string) =>
  new AppException({
    title: 'Precondition required',
    status: 428,
    code: 'PRECONDITION_REQUIRED',
    detail,
  });

export const TooEarlyException = (detail?: string) =>
  new AppException({
    title: 'Too early',
    status: 425,
    code: 'TOO_EARLY',
    detail,
  });

export const PayloadTooLarge = (maxMB?: number, detail?: string) =>
  new AppException({
    title: 'Payload too large',
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
    detail: detail ?? (maxMB ? `Max ${maxMB}MB` : undefined),
  });

export const RateLimitedException = (retryAfterSec: number, detail?: string) =>
  new AppException({
    title: 'Too many requests. Try later.',
    status: 429,
    code: 'RATE_LIMITED',
    retryAfterSec,
    detail,
  });

export const MfaRequired = (detail?: string) =>
  new AppException({
    title: 'MFA required',
    status: 401,
    code: 'MFA_REQUIRED',
    detail,
  });

export const AccountBanned = (banUntil: string, detail?: string) =>
  new AppException({
    title: 'Account banned',
    status: 403,
    code: 'ACCOUNT_BANNED',
    banUntil,
    detail,
  });

export const LegalBlocked = (detail?: string) =>
  new AppException({
    title: 'Unavailable for legal reasons',
    status: 451,
    code: 'LEGAL_BLOCKED',
    detail,
  });

export const InternalError = (detail?: string) =>
  new AppException({
    title: 'Internal server error',
    status: 500,
    code: 'INTERNAL_ERROR',
    detail,
  });

/* ============================
 * Helper sugar ví dụ cho Rate Limit
 * ============================
 */
export const to429 = (d: { retryAfterSec: number; detail?: string }) =>
  RateLimitedException(d.retryAfterSec, d.detail);
