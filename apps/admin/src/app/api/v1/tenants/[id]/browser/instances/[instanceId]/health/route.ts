import { createApiHandler } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { browserIntegrationService } from '@/lib/services';
import { operatorTenantContext } from '@/lib/operator-tenant';

// Test health + API key of an existing instance (re-reads its credential).
export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (_request, ctx, params) => {
    const scoped = operatorTenantContext(ctx, params['id'] ?? '');
    return browserIntegrationService.testInstanceHealth(scoped, params['instanceId'] ?? '');
  },
);
