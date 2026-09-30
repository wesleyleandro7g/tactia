import { createId } from '@tactia/shared';
import { createApiHandler, readJson } from '@/lib/api';
import { automationService } from '@/lib/automations';
import { operatorTenantContext } from '@/lib/operator-tenant';

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
  const body = (await readJson(request)) as { params?: Record<string, unknown>; idempotencyKey?: string };
  return automationService.start(operatorTenantContext(ctx, params['id']!), {
    automationId: params['automationId']!,
    params: body.params ?? {},
    origin: 'page',
    idempotencyKey: body.idempotencyKey?.trim() || `ops-test:${createId()}`,
    operatorTest: true,
  });
});
