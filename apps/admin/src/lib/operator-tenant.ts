import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';

/**
 * Build a tenant-scoped RequestContext for an authenticated operator acting on
 * a specific tenant. Mirrors the backoffice service's internal scoping so that
 * tenant-scoped domain services (BrowserIntegrationService, CredentialService)
 * receive both `operatorId` and `tenantId`.
 */
export function operatorTenantContext(ctx: RequestContext, tenantId: string): RequestContext {
  if (!ctx.operatorId) {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Authentication required');
  }
  if (!tenantId) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Tenant id ausente na rota.');
  }
  return {
    requestId: ctx.requestId,
    tenantId,
    userId: null,
    role: 'owner',
    ip: ctx.ip ?? null,
    operatorId: ctx.operatorId,
  };
}
