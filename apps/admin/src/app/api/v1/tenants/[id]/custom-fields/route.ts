import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { backofficeService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
  const entityType = new URL(request.url).searchParams.get('entityType') ?? undefined;
  return backofficeService.listCustomFields(ctx, params['id'] ?? '', entityType);
});

export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => {
    return backofficeService.createCustomField(ctx, params['id'] ?? '', await readJson(request));
  },
);
