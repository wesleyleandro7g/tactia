import { createApiHandler, readJson } from '@/lib/api';
import { resetTenantScheduleOccurrence } from '@/lib/tenant-schedules';

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
  const body = (await readJson(request)) as { periodKey?: string };
  return resetTenantScheduleOccurrence(ctx, params['id']!, params['scheduleId']!, body.periodKey ?? '');
});
