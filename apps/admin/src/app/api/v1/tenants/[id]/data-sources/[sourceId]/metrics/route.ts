import { createApiHandler } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { backofficeService } from '@/lib/services';

export const GET = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (_request, ctx, params) => {
    return backofficeService.getTrelloMetrics(ctx, params['id'] ?? '', params['sourceId'] ?? '');
  },
);
