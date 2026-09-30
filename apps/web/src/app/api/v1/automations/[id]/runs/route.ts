import { createApiHandler, readJson } from '@/lib/api';
import { automationService } from '@/lib/automations';
import { AppError, ErrorCode } from '@tactia/shared';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  const detail = await automationService.get(ctx, params['id']!);
  return { items: detail.runs };
});

export const POST = createApiHandler({ auth: 'tenant', roles: ['member', 'admin', 'owner'] }, async (request, ctx, params) => {
  const body = (await readJson(request)) as { params?: Record<string, unknown>; idempotencyKey?: string };
  if (!body.idempotencyKey) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Informe idempotencyKey.');
  return automationService.start(ctx, {
    automationId: params['id']!,
    params: body.params ?? {},
    origin: 'page',
    idempotencyKey: body.idempotencyKey,
  });
});
