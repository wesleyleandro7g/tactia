import { createApiHandler, readJson, searchParamsRecord } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { browserIntegrationService } from '@/lib/services';
import { operatorTenantContext } from '@/lib/operator-tenant';

const DEFAULT_PROVIDER = 'torge';
const DEFAULT_ENVIRONMENT = 'production';

export const GET = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
  const scoped = operatorTenantContext(ctx, params['id'] ?? '');
  const query = searchParamsRecord(request);
  const items = await browserIntegrationService.listInstances(
    scoped,
    query['provider'] ?? DEFAULT_PROVIDER,
    query['environment'] ?? DEFAULT_ENVIRONMENT,
  );
  return { items };
});

export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => {
    const scoped = operatorTenantContext(ctx, params['id'] ?? '');
    return browserIntegrationService.createInstance(scoped, await readJson(request));
  },
);
