import { createApiHandler, readJson, searchParamsRecord } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { backofficeService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'operator' }, async (request, ctx) => {
  return backofficeService.listTenants(ctx, searchParamsRecord(request));
});

export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx) => {
    return backofficeService.provisionTenant(ctx, await readJson(request));
  },
);
