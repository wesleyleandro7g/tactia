import { prisma } from '@tactia/database';
import type { RequestContext } from '@tactia/shared';
import { scopedTenant, whatsappAuthorizedNumberService } from './settings-services';

export async function listTenantWhatsappNumbers(ctx: RequestContext, tenantId: string) {
  const scoped = await scopedTenant(ctx, tenantId);
  const [numbers, users] = await Promise.all([
    whatsappAuthorizedNumberService.list(scoped),
    listActiveTenantUsers(tenantId),
  ]);
  return { numbers, users };
}

export async function createTenantWhatsappNumber(ctx: RequestContext, tenantId: string, raw: unknown) {
  const scoped = await scopedTenant(ctx, tenantId);
  return whatsappAuthorizedNumberService.create(scoped, raw);
}

export async function updateTenantWhatsappNumber(
  ctx: RequestContext,
  tenantId: string,
  numberId: string,
  raw: unknown,
) {
  const scoped = await scopedTenant(ctx, tenantId);
  return whatsappAuthorizedNumberService.update(scoped, numberId, raw);
}

export async function disableTenantWhatsappNumber(ctx: RequestContext, tenantId: string, numberId: string) {
  const scoped = await scopedTenant(ctx, tenantId);
  return whatsappAuthorizedNumberService.disable(scoped, numberId);
}

async function listActiveTenantUsers(tenantId: string) {
  const memberships = await prisma.membership.findMany({
    where: { tenantId, status: 'active' },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return memberships.map((membership) => ({
    id: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
  }));
}
