import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { backofficeService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'operator' }, async (_request, ctx, params) => {
  const detail = await backofficeService.getTenant(ctx, params['id'] ?? '');
  return { items: detail.dataSources };
});

export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => {
    return backofficeService.createDataSource(ctx, params['id'] ?? '', await readJson(request));
  },
);
