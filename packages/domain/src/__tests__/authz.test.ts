import { describe, expect, it } from 'vitest';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertOperator, assertOwnerOrAdmin, assertRole, hasMinRole } from '../authz';

function ctx(role: RequestContext['role']): RequestContext {
  return {
    requestId: 'req_test',
    tenantId: 'tenant_a',
    userId: 'user_a',
    role,
  };
}

describe('authorization', () => {
  it('ranks roles', () => {
    expect(hasMinRole('viewer', 'admin')).toBe(false);
    expect(hasMinRole('admin', 'admin')).toBe(true);
    expect(hasMinRole('owner', 'admin')).toBe(true);
  });

  it('blocks viewers from admin actions', () => {
    expect(() => assertOwnerOrAdmin(ctx('viewer'))).toThrow(AppError);
    try {
      assertOwnerOrAdmin(ctx('member'));
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.AUTHORIZATION_ERROR);
    }
  });

  it('allows owner to pass role gates', () => {
    expect(() => assertRole(ctx('owner'), 'viewer')).not.toThrow();
    expect(() => assertOwnerOrAdmin(ctx('owner'))).not.toThrow();
  });

  it('requires operatorId for operator actions', () => {
    expect(() => assertOperator(ctx('owner'))).toThrow(AppError);
    expect(() =>
      assertOperator({
        requestId: 'req_ops',
        tenantId: null,
        userId: null,
        role: null,
        operatorId: 'op_a',
      }),
    ).not.toThrow();
  });
});
