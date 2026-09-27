import { createApiHandler } from '@/lib/api';
import { listTenantScheduleOccurrences } from '@/lib/tenant-schedules';

export const GET = createApiHandler({ auth: 'operator' }, (_request, ctx, params) =>
  listTenantScheduleOccurrences(ctx, params['id']!, params['scheduleId']!),
);
