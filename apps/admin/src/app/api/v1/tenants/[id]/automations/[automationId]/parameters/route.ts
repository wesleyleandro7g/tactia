import { createApiHandler, readJson } from '@/lib/api';
import { automationService } from '@/lib/automations';
import { operatorTenantContext } from '@/lib/operator-tenant';

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
  const body = (await readJson(request)) as { values?: Record<string, unknown> };
  return automationService.updateReleasedParameters(
    operatorTenantContext(ctx, params['id']!),
    params['automationId']!,
    body.values ?? {},
  );
});
