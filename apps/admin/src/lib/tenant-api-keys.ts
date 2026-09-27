import { prisma } from '@tactia/database';
import { hasMinRole } from '@tactia/domain';
import { AppError, ErrorCode, type MembershipRole, type RequestContext } from '@tactia/shared';
import { scopedTenant, tenantApiKeyService } from './settings-services';

export async function listTenantApiKeys(ctx: RequestContext, tenantId: string) {
  const scoped = await scopedTenant(ctx, tenantId);
  const keys = await tenantApiKeyService.list(scoped);
  const owners = await listTenantKeyOwners(tenantId);
  return { keys, owners };
}

/**
 * A tenant API key must be attributed to a real tenant user (`createdBy` is a
 * FK to `User`, and the key's role becomes its MCP principal). Operators have
 * no tenant user, so the admin issues the key on behalf of an owner/admin the
 * operator selects. The operator still owns the audit trail (`operatorId`).
 */
export async function createTenantApiKey(ctx: RequestContext, tenantId: string, raw: unknown) {
  const scoped = await scopedTenant(ctx, tenantId);
  const body = (raw ?? {}) as { userId?: unknown; name?: unknown; scopes?: unknown };
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  if (!userId) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Selecione o usuário responsável pela chave.');
  }
  const role = await resolveKeyOwnerRole(tenantId, userId);
  // Issue the key as the chosen tenant user while keeping operator attribution.
  const keyCtx: RequestContext = { ...scoped, userId, role };
  return tenantApiKeyService.create(keyCtx, { name: body.name, scopes: body.scopes });
}

export async function revokeTenantApiKey(ctx: RequestContext, tenantId: string, keyId: string) {
  const scoped = await scopedTenant(ctx, tenantId);
  return tenantApiKeyService.revoke(scoped, keyId);
}

async function listTenantKeyOwners(tenantId: string) {
  const memberships = await prisma.membership.findMany({
    where: { tenantId, role: { in: ['owner', 'admin'] } },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { role: 'asc' },
  });
  return memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
  }));
}

async function resolveKeyOwnerRole(tenantId: string, userId: string): Promise<MembershipRole> {
  const membership = await prisma.membership.findFirst({
    where: { tenantId, userId },
    select: { role: true },
  });
  if (!membership) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Usuário não pertence a esta empresa.');
  }
  if (!hasMinRole(membership.role, 'admin')) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'A chave deve pertencer a um owner ou admin.');
  }
  return membership.role;
}
