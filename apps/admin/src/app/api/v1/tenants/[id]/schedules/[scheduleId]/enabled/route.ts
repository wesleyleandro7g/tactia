import { createApiHandler, readJson } from '@/lib/api';
import { setTenantScheduleEnabled } from '@/lib/tenant-schedules';

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
  const body = (await readJson(request)) as { enabled?: boolean };
  return setTenantScheduleEnabled(ctx, params['id']!, params['scheduleId']!, body.enabled ?? false);
});
