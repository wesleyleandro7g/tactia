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

export function assertTenantContext(ctx: RequestContext): asserts ctx is RequestContext & {
  userId: string;
  tenantId: string;
  role: MembershipRole;
} {
  assertAuthenticated(ctx);
  if (!ctx.tenantId || !ctx.role) {
    throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'An active tenant is required');
  }
}

export function hasMinRole(role: MembershipRole | null, min: MembershipRole): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[min];
}

export function assertRole(
  ctx: RequestContext,
  min: MembershipRole,
): asserts ctx is RequestContext & {
  userId: string;
  tenantId: string;
  role: MembershipRole;
} {
  assertTenantContext(ctx);
  if (!hasMinRole(ctx.role, min)) {
    throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Insufficient permissions');
  }
}

export function assertOwnerOrAdmin(ctx: RequestContext): asserts ctx is RequestContext & {
  userId: string;
  tenantId: string;
  role: MembershipRole;
} {
  assertRole(ctx, 'admin');
}
