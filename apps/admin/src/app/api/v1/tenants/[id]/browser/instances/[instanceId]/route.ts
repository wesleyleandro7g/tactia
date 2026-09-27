import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { browserIntegrationService } from '@/lib/services';
import { operatorTenantContext } from '@/lib/operator-tenant';

export const GET = createApiHandler({ auth: 'operator' }, async (_request, ctx, params) => {
  const scoped = operatorTenantContext(ctx, params['id'] ?? '');
  return browserIntegrationService.getInstance(scoped, params['instanceId'] ?? '');
});

// Edit URL / rotate API key / toggle active / allowInsecureHttp.
export const PATCH = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => {
    const scoped = operatorTenantContext(ctx, params['id'] ?? '');
    return browserIntegrationService.updateInstance(scoped, params['instanceId'] ?? '', await readJson(request));
  },
);

// Disable (soft): sets active=false. The container stays provisioned outside BKO.
export const DELETE = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (_request, ctx, params) => {
    const scoped = operatorTenantContext(ctx, params['id'] ?? '');
    return browserIntegrationService.disableInstance(scoped, params['instanceId'] ?? '');
  },
);
