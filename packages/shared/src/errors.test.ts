import { describe, expect, it } from 'vitest';
import { AppError, ErrorCode, isAppError } from './errors';

describe('AppError', () => {
  it('maps classified codes to HTTP status', () => {
    expect(new AppError(ErrorCode.VALIDATION_ERROR, 'invalid').statusCode).toBe(400);
    expect(new AppError(ErrorCode.AUTHENTICATION_ERROR, 'auth').statusCode).toBe(401);
    expect(new AppError(ErrorCode.AUTHORIZATION_ERROR, 'authz').statusCode).toBe(403);
    expect(new AppError(ErrorCode.NOT_FOUND, 'missing').statusCode).toBe(404);
    expect(new AppError(ErrorCode.CONFLICT, 'dup').statusCode).toBe(409);
    expect(new AppError(ErrorCode.INTERNAL_ERROR, 'boom').statusCode).toBe(500);
  });

  it('is identifiable without exposing internals', () => {
    const error = new AppError(ErrorCode.NOT_FOUND, 'Tenant not found');
    expect(isAppError(error)).toBe(true);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.stack).toBeTruthy();
  });
});
