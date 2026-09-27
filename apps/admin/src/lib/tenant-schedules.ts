import type { RequestContext } from '@tactia/shared';
import { scheduleService, scopedTenant } from './settings-services';

export async function listTenantSchedules(ctx: RequestContext, tenantId: string) {
  const scoped = await scopedTenant(ctx, tenantId);
  return scheduleService.list(scoped, {});
}

export async function createTenantSchedule(ctx: RequestContext, tenantId: string, raw: unknown) {
  const scoped = await scopedTenant(ctx, tenantId);
  return scheduleService.create(scoped, raw, { actorType: 'operator' });
}

export async function updateTenantSchedule(
  ctx: RequestContext,
  tenantId: string,
  scheduleId: string,
  raw: unknown,
) {
  const scoped = await scopedTenant(ctx, tenantId);
  return scheduleService.update(scoped, scheduleId, raw, { actorType: 'operator' });
}

export async function setTenantScheduleEnabled(
  ctx: RequestContext,
  tenantId: string,
  scheduleId: string,
  enabled: boolean,
) {
  const scoped = await scopedTenant(ctx, tenantId);
  return scheduleService.setEnabled(scoped, scheduleId, enabled, { actorType: 'operator' });
}

export async function deleteTenantSchedule(ctx: RequestContext, tenantId: string, scheduleId: string) {
  const scoped = await scopedTenant(ctx, tenantId);
  return scheduleService.delete(scoped, scheduleId, { actorType: 'operator' });
}

export async function triggerTenantSchedule(ctx: RequestContext, tenantId: string, scheduleId: string) {
  const scoped = await scopedTenant(ctx, tenantId);
  return scheduleService.triggerNow(scoped, scheduleId, { actorType: 'operator' });
}

export async function resetTenantScheduleOccurrence(
  ctx: RequestContext,
  tenantId: string,
  scheduleId: string,
  periodKey: string,
) {
  const scoped = await scopedTenant(ctx, tenantId);
  return scheduleService.resetOccurrence(scoped, scheduleId, periodKey, { actorType: 'operator' });
}

export async function listTenantScheduleOccurrences(
  ctx: RequestContext,
  tenantId: string,
  scheduleId: string,
) {
  const scoped = await scopedTenant(ctx, tenantId);
  return scheduleService.listOccurrences(scoped, scheduleId, {});
}
