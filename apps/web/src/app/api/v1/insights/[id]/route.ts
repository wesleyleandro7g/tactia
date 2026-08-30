import { createApiHandler, readJson } from '@/lib/api';
import { insightService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return insightService.getById(ctx, params['id']!);
});

export const PATCH = createApiHandler({ auth: 'tenant' }, async (request, ctx, params) => {
  const body = await readJson(request);
  return insightService.updateStatus(ctx, params['id']!, body);
});
