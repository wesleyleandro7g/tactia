import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { createPreparedObjective, listPreparation } from '@/lib/command-center-preparation';

export const GET = createApiHandler({ auth: 'operator' }, (_request, ctx, params) =>
  listPreparation(ctx, params['id'] ?? ''),
);

export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => createPreparedObjective(ctx, params['id'] ?? '', await readJson(request)),
);
