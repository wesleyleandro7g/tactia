import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { operatorService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'operator' }, async (_request, ctx) => {
  return operatorService.list(ctx);
});

export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx) => {
    return operatorService.create(ctx, await readJson(request));
  },
);
