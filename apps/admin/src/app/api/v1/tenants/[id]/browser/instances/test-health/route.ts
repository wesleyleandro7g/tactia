import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { browserIntegrationService } from '@/lib/services';
import { operatorTenantContext } from '@/lib/operator-tenant';

/**
 * Probe executor health + API key before the instance is created (wizard step).
 * The API key is used transiently for the probe and never persisted or echoed.
 */
export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => {
    const scoped = operatorTenantContext(ctx, params['id'] ?? '');
    return browserIntegrationService.testHealth(scoped, await readJson(request));
  },
);
