import { describe, expect, it } from 'vitest';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import {
  assertCanManageConnections,
  assertOperator,
  assertOwnerOrAdmin,
  assertRole,
  assertTenantContext,
  assertTenantScope,
  assertTenantUser,
  hasMinRole,
} from '../authz';

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

  it('lets operators manage connections only with a tenant', () => {
    const owner = ctx('owner');
    expect(() => assertCanManageConnections(owner)).toThrow(AppError);
    expect(() =>
      assertCanManageConnections({
        requestId: 'req_ops',
        tenantId: 'tenant_a',
        userId: null,
        role: 'owner',
        operatorId: 'op_a',
      }),
    ).not.toThrow();
    expect(() =>
      assertTenantScope({
        requestId: 'req_ops',
        tenantId: 'tenant_a',
        userId: null,
        role: 'owner',
        operatorId: 'op_a',
      }),
    ).not.toThrow();
  });

  describe('operator principal (admin test chat)', () => {
    const operator: RequestContext = {
      requestId: 'req_ops',
      tenantId: 'tenant_a',
      userId: null,
      role: 'owner',
      operatorId: 'op_a',
    };

    it('accepts an operator with tenant + role in tenant/role gates', () => {
      expect(() => assertTenantContext(operator)).not.toThrow();
      expect(() => assertRole(operator, 'member')).not.toThrow();
      expect(() => assertOwnerOrAdmin(operator)).not.toThrow();
    });

    it('still requires a tenant and a role for operators', () => {
      expect(() => assertTenantContext({ ...operator, tenantId: null })).toThrow(AppError);
      expect(() => assertTenantContext({ ...operator, role: null })).toThrow(AppError);
    });

    it('rejects a context with neither user nor operator', () => {
      try {
        assertTenantContext({ ...operator, operatorId: null });
        throw new Error('should have thrown');
      } catch (error) {
        expect((error as AppError).code).toBe(ErrorCode.AUTHENTICATION_ERROR);
      }
    });

    it('assertTenantUser keeps requiring a real user', () => {
      expect(() => assertTenantUser(operator)).toThrow(AppError);
      expect(() => assertTenantUser(ctx('viewer'))).not.toThrow();
    });
  });
});
