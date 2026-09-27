import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { browserIntegrationService } from '@/lib/services';
import { operatorTenantContext } from '@/lib/operator-tenant';

/**
 * Publish the active revision to a remote executor. A new remote task is created
 * per revision; same-marker tasks are reconciled (updated). Remote scheduling is
 * always forced off by the publisher.
 */
export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => {
    const scoped = operatorTenantContext(ctx, params['id'] ?? '');
    const body = (await readJson(request)) as { instanceId?: string };
    return browserIntegrationService.publishWorkflow(scoped, {
      workflowId: params['workflowId'] ?? '',
      instanceId: body.instanceId ?? '',
    });
  },
);
