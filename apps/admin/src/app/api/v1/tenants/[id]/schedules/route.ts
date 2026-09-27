import { createApiHandler, readJson } from '@/lib/api';
import { createTenantSchedule, listTenantSchedules } from '@/lib/tenant-schedules';

export const GET = createApiHandler({ auth: 'operator' }, (_request, ctx, params) =>
  listTenantSchedules(ctx, params['id']!),
);

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) =>
  createTenantSchedule(ctx, params['id']!, await readJson(request)),
);
