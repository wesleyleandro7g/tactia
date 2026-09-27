import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { browserIntegrationService } from '@/lib/services';
import { operatorTenantContext } from '@/lib/operator-tenant';

/**
 * Repoint the active revision (revert/reconcile) without deleting history. The
 * immutable revisions remain available.
 */
export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx, params) => {
    const scoped = operatorTenantContext(ctx, params['id'] ?? '');
    const body = (await readJson(request)) as { revisionId?: string };
    return browserIntegrationService.setActiveRevision(scoped, {
      workflowId: params['workflowId'] ?? '',
      revisionId: body.revisionId ?? '',
    });
  },
);
