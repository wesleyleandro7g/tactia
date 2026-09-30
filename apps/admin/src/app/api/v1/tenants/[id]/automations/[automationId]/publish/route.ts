import { createApiHandler, readJson } from '@/lib/api';
import { automationService } from '@/lib/automations';
import { operatorTenantContext } from '@/lib/operator-tenant';
import { AppError, ErrorCode } from '@tactia/shared';

export const POST = createApiHandler({ auth: 'operator' }, async (request, ctx, params) => {
  const body = (await readJson(request)) as { versionId?: string };
  if (!body.versionId) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Informe versionId.');
  return automationService.publish(operatorTenantContext(ctx, params['id']!), params['automationId']!, body.versionId);
});
