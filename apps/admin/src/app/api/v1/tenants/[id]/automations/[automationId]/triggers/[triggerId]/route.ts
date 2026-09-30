import { createApiHandler, readJson } from '@/lib/api';
import { automationService } from '@/lib/automations';
import { operatorTenantContext } from '@/lib/operator-tenant';

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
  const body = (await readJson(request)) as { enabled?: boolean };
  return automationService.setTriggerEnabled(
    operatorTenantContext(ctx, params['id']!),
    params['automationId']!,
    params['triggerId']!,
    body.enabled === true,
  );
});
