import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { backofficeService } from '@/lib/services';

export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => {
    return backofficeService.createCredential(ctx, params['id'] ?? '', await readJson(request));
  },
);
