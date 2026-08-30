import { createApiHandler, readJson } from '@/lib/api';
import { actionService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return actionService.get(ctx, params['id']!);
});

/** PATCH /api/v1/actions/:id — name, description, configuration, requiresApproval, enabled */
export const PATCH = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx, params) => {
    return actionService.update(ctx, params['id']!, await readJson(request));
  },
);
