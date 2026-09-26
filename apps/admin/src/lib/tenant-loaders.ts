import { cache } from 'react';
import { notFound } from 'next/navigation';
import { ErrorCode, isAppError } from '@tactia/shared';
import { requireOperator } from '@/lib/server-context';
import { backofficeService } from '@/lib/services';

async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (isAppError(error) && error.code === ErrorCode.NOT_FOUND) notFound();
    throw error;
  }
}

/**
 * Per-request loaders for the tenant detail tabs. `cache()` dedupes the operator
 * lookup and the header between the shared layout and the active tab page.
 */
export const loadOperator = cache((tenantId: string) => requireOperator(`/tenants/${tenantId}`));

export const loadTenantHeader = cache(async (tenantId: string) => {
  const { ctx } = await loadOperator(tenantId);
  return orNotFound(backofficeService.getTenantHeader(ctx, tenantId));
});

export async function loadTenantCustomFields(tenantId: string) {
  const { ctx } = await loadOperator(tenantId);
  return orNotFound(backofficeService.listCustomFields(ctx, tenantId));
}

export async function loadTenantUsers(tenantId: string) {
  const { ctx } = await loadOperator(tenantId);
  return orNotFound(backofficeService.listTenantUsers(ctx, tenantId));
}

export async function loadTenantDataSources(tenantId: string) {
  const { ctx } = await loadOperator(tenantId);
  return orNotFound(backofficeService.listTenantDataSources(ctx, tenantId));
}

export async function loadTenantSyncHistory(tenantId: string) {
  const { ctx } = await loadOperator(tenantId);
  return orNotFound(backofficeService.getTenantSyncHistory(ctx, tenantId));
}

export async function loadTenantActivity(tenantId: string) {
  const { ctx } = await loadOperator(tenantId);
  return orNotFound(backofficeService.getTenantActivity(ctx, tenantId));
}
