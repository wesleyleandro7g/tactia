import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { backofficeService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'operator' }, async (_request, ctx, params) => {
  return backofficeService.getDataSource(ctx, params['id'] ?? '', params['sourceId'] ?? '');
});

export const PATCH = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => {
    return backofficeService.updateDataSource(
      ctx,
      params['id'] ?? '',
      params['sourceId'] ?? '',
      await readJson(request),
    );
  },
);

export const DELETE = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (_request, ctx, params) => {
    return backofficeService.removeDataSource(ctx, params['id'] ?? '', params['sourceId'] ?? '');
  },
);
