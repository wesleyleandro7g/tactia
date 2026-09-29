import { createApiHandler, readJson } from '@/lib/api';
import { commandCenterService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return commandCenterService.getPlan(ctx, params.id ?? '');
});

export const PATCH = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx, params) =>
    commandCenterService.updatePlanStatus(ctx, params.id ?? '', await readJson(request)),
);
