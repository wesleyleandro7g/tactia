import { createApiHandler, readJson } from '@/lib/api';
import { automationService } from '@/lib/automations';
import { operatorTenantContext } from '@/lib/operator-tenant';

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
  const body = (await readJson(request)) as { enabled?: boolean };
  return automationService.setTenantEnabled(operatorTenantContext(ctx, params['id']!), body.enabled === true);
});
