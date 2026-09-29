import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { createPreparedPlan } from '@/lib/command-center-preparation';

export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => createPreparedPlan(ctx, params['id'] ?? '', await readJson(request)),
);
