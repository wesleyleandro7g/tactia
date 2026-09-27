import { createApiHandler } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { backofficeService } from '@/lib/services';

export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.sync },
  async (_request, ctx, params) => {
    return backofficeService.cancelSync(
      ctx,
      params['id'] ?? '',
      params['syncJobId'] ?? '',
    );
  },
);
