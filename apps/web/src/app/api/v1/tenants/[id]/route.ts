import { AppError, ErrorCode } from '@tactia/shared';
import { createApiHandler, readJson } from '@/lib/api';
import { tenantService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'user' }, async (_request, ctx, params) => {
  return tenantService.get(ctx, params.id ?? '');
});

export const PATCH = createApiHandler({ auth: 'user' }, async (request, ctx, params) => {
  const tenant = await tenantService.get(ctx, params.id ?? '');
  if (tenant.role !== 'owner' && tenant.role !== 'admin') {
    throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Insufficient permissions');
  }
  const body = await readJson(request);
  return tenantService.update({ ...ctx, tenantId: tenant.id, role: tenant.role }, body);
});
