import type { RequestContext } from '@tactia/shared';
import { playbookService, scopedTenant } from './settings-services';

export async function listTenantPlaybooks(ctx: RequestContext, tenantId: string) {
  const scoped = await scopedTenant(ctx, tenantId);
  return playbookService.list(scoped);
}

export async function createTenantPlaybook(ctx: RequestContext, tenantId: string, raw: unknown) {
  const scoped = await scopedTenant(ctx, tenantId);
  return playbookService.create(scoped, raw);
}

export async function updateTenantPlaybook(
  ctx: RequestContext,
  tenantId: string,
  playbookId: string,
  raw: unknown,
) {
  const scoped = await scopedTenant(ctx, tenantId);
  return playbookService.update(scoped, playbookId, raw);
}

export async function removeTenantPlaybook(ctx: RequestContext, tenantId: string, playbookId: string) {
  const scoped = await scopedTenant(ctx, tenantId);
  return playbookService.remove(scoped, playbookId);
}
