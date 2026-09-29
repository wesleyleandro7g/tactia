import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { getCommandCenterRelease, setCommandCenterRelease } from '@/lib/command-center-release';

export const GET = createApiHandler({ auth: 'operator' }, async (_request, ctx, params) =>
  getCommandCenterRelease(ctx, params['id'] ?? ''),
);

export const PUT = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) =>
    setCommandCenterRelease(ctx, params['id'] ?? '', await readJson(request)),
);
