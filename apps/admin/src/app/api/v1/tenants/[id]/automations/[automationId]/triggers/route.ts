import { createApiHandler, readJson } from '@/lib/api';
import { automationService } from '@/lib/automations';
import { operatorTenantContext } from '@/lib/operator-tenant';
import { AppError, ErrorCode } from '@tactia/shared';

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
  const body = (await readJson(request)) as {
    kind?: 'webhook' | 'internal_event';
    eventType?: string;
    connectionId?: string;
  };
  if (body.kind !== 'webhook' && body.kind !== 'internal_event') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Informe o tipo do gatilho.');
  }
  return automationService.createTrigger(operatorTenantContext(ctx, params['id']!), params['automationId']!, {
    kind: body.kind,
    ...(body.eventType ? { eventType: body.eventType } : {}),
    ...(body.connectionId ? { connectionId: body.connectionId } : {}),
  });
});
