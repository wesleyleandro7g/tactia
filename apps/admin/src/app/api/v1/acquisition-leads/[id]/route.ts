import { createApiHandler, readJson } from '@/lib/api';
import { acquisitionLeadService } from '@/lib/acquisition';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const GET = createApiHandler({ auth: 'operator' }, (_request, ctx, params) =>
  acquisitionLeadService.get(ctx, params.id ?? ''),
);
export const PATCH = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) =>
    acquisitionLeadService.updateStatus(ctx, params.id ?? '', await readJson(request)),
);
