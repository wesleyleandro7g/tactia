import { createApiHandler } from '@/lib/api';
import { triggerTenantSchedule } from '@/lib/tenant-schedules';

export const POST = createApiHandler({ auth: 'operator' }, (_request, ctx, params) =>
  triggerTenantSchedule(ctx, params['id']!, params['scheduleId']!),
);
