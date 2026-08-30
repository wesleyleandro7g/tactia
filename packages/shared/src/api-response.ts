import type { ErrorCode } from './errors';

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
};

export type ApiSuccess<T> = {
  data: T;
  meta: {
    requestId: string;
    pagination?: PaginationMeta;
  };
};

export type ApiErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
  meta: {
    requestId: string;
  };
};

export function ok<T>(
  data: T,
  requestId: string,
  pagination?: PaginationMeta,
): ApiSuccess<T> {
  return {
    data,
    meta: pagination ? { requestId, pagination } : { requestId },
  };
}

export function fail(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: unknown,
): ApiErrorBody {
  return {
    error: { code, message, ...(details !== undefined ? { details } : {}) },
    meta: { requestId },
  };
}
