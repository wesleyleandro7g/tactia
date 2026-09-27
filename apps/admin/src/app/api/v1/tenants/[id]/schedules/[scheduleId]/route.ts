import { createApiHandler, readJson } from '@/lib/api';
import { deleteTenantSchedule, updateTenantSchedule } from '@/lib/tenant-schedules';

export const PATCH = createApiHandler({ auth: 'operator' }, async (request, ctx, params) =>
  updateTenantSchedule(ctx, params['id']!, params['scheduleId']!, await readJson(request)),
);

export const DELETE = createApiHandler({ auth: 'operator' }, (_request, ctx, params) =>
  deleteTenantSchedule(ctx, params['id']!, params['scheduleId']!),
);
