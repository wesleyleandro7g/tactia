import { AppError, ErrorCode, MembershipRole, type RequestContext } from '@tactia/shared';

const RANK: Record<MembershipRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export function assertAuthenticated(ctx: RequestContext): asserts ctx is RequestContext & {
  userId: string;
} {
  if (!ctx.userId) {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Authentication required');
  }
}

export function assertOperator(ctx: RequestContext): asserts ctx is RequestContext & {
  operatorId: string;
} {
  if (!ctx.operatorId) {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Authentication required');
  }
}

/**
 * Tenant-scoped principal: either a client user with an active membership or a
 * backoffice operator acting on a tenant (`operatorTenantContext` in apps/admin,
 * which sets `userId: null`, `operatorId` and `role`). Operators have no domain
 * user, so `userId` is nullable here; use `assertTenantUser` where a real user
 * is required (e.g. persisted conversations, personal data).
 */
export function assertTenantContext(ctx: RequestContext): asserts ctx is RequestContext & {
  userId: string | null;
  tenantId: string;
  role: MembershipRole;
} {
  if (!ctx.userId && !ctx.operatorId) {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Authentication required');
  }
  if (!ctx.tenantId || !ctx.role) {
    throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'An active tenant is required');
  }
}

/** Tenant context that must belong to a client user (operators are rejected). */
export function assertTenantUser(ctx: RequestContext): asserts ctx is RequestContext & {
  userId: string;
  tenantId: string;
  role: MembershipRole;
} {
  assertAuthenticated(ctx);
  assertTenantContext(ctx);
}

export function hasMinRole(role: MembershipRole | null, min: MembershipRole): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[min];
}

export function assertRole(
  ctx: RequestContext,
  min: MembershipRole,
): asserts ctx is RequestContext & {
  userId: string | null;
  tenantId: string;
  role: MembershipRole;
} {
  assertTenantContext(ctx);
  if (!hasMinRole(ctx.role, min)) {
    throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Insufficient permissions');
  }
}

export function assertOwnerOrAdmin(ctx: RequestContext): asserts ctx is RequestContext & {
  userId: string | null;
  tenantId: string;
  role: MembershipRole;
} {
  assertRole(ctx, 'admin');
}

/**
 * Tenant-scoped read: a client membership or a backoffice operator impersonating
 * that tenant (operatorTenantCtx).
 */
export function assertTenantScope(ctx: RequestContext): asserts ctx is RequestContext & {
  tenantId: string;
} {
  if (ctx.operatorId) {
    if (!ctx.tenantId) {
      throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'An active tenant is required');
    }
    return;
  }
  assertTenantContext(ctx);
}

export function assertOperatorForTenant(ctx: RequestContext): asserts ctx is RequestContext & {
  operatorId: string;
  tenantId: string;
} {
  assertOperator(ctx);
  if (!ctx.tenantId) {
    throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'An active tenant is required');
  }
}

const CONNECTIONS_OPERATOR_ONLY = 'Data source connections are managed by Tactia operators';

/** Create/update/remove of connections, credentials and mappings. */
export function assertCanManageConnections(ctx: RequestContext): asserts ctx is RequestContext & {
  operatorId: string;
  tenantId: string;
} {
  if (ctx.operatorId && ctx.tenantId) return;
  throw new AppError(ErrorCode.AUTHORIZATION_ERROR, CONNECTIONS_OPERATOR_ONLY);
}
