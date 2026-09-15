import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { backofficeService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'operator' }, async (_request, ctx, params) => {
  return backofficeService.listMappings(ctx, params['id'] ?? '', params['sourceId'] ?? '');
});

export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => {
    return backofficeService.createMapping(
      ctx,
      params['id'] ?? '',
      params['sourceId'] ?? '',
      await readJson(request),
    );
  },
);
