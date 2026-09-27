import { describe, expect, it } from 'vitest';
import { AppError, type RequestContext } from '@tactia/shared';
import { operatorTenantContext } from '../operator-tenant';

function baseCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  return { requestId: 'req-1', tenantId: null, userId: null, role: null, operatorId: null, ip: null, ...overrides };
}

describe('operatorTenantContext', () => {
  it('builds a tenant-scoped owner context for an authenticated operator', () => {
    const scoped = operatorTenantContext(baseCtx({ operatorId: 'op-1', ip: '1.2.3.4' }), 'tenant-1');
    expect(scoped).toMatchObject({
      requestId: 'req-1',
      tenantId: 'tenant-1',
      operatorId: 'op-1',
      role: 'owner',
      userId: null,
      ip: '1.2.3.4',
    });
  });

  it('rejects when the operator is not authenticated', () => {
    expect(() => operatorTenantContext(baseCtx(), 'tenant-1')).toThrow(AppError);
  });

  it('rejects when the tenant id is missing', () => {
    expect(() => operatorTenantContext(baseCtx({ operatorId: 'op-1' }), '')).toThrow(AppError);
  });
});
