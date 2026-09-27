import { createApiHandler } from '@/lib/api';
import { browserIntegrationService } from '@/lib/services';
import { operatorTenantContext } from '@/lib/operator-tenant';

export const GET = createApiHandler({ auth: 'operator' }, async (_request, ctx, params) => {
  const scoped = operatorTenantContext(ctx, params['id'] ?? '');
  const items = await browserIntegrationService.listRevisions(scoped, params['workflowId'] ?? '');
  return { items };
});
