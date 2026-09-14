import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { backofficeService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'operator' }, async (_request, ctx, params) => {
  return backofficeService.getTenant(ctx, params['id'] ?? '');
});

export const PATCH = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => {
    return backofficeService.updateTenant(ctx, params['id'] ?? '', await readJson(request));
  },
);
