import { AppError, ErrorCode } from '@tactia/shared';
import { createApiHandler, readJson } from '@/lib/api';
import { automationService } from '@/lib/automations';

export const POST = createApiHandler({ auth: 'tenant', roles: ['admin', 'owner'] }, async (request, ctx, params) => {
  const body = (await readJson(request)) as { decision?: 'confirmed' | 'not_sent' };
  if (body.decision !== 'confirmed' && body.decision !== 'not_sent') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Informe se o envio foi confirmado ou não ocorreu.');
  }
  return automationService.reconcile(ctx, params['id']!, params['runId']!, body.decision);
});
