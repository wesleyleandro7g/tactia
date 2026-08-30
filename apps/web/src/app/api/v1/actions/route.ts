import { createApiHandler, readJson, searchParamsRecord } from '@/lib/api';
import { actionService } from '@/lib/services';

/**
 * GET /api/v1/actions
 * Tenant action catalog (query: enabled, page, pageSize) + executable types.
 * `mode=definitions` returns only what this build knows how to execute.
 */
export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  const params = searchParamsRecord(request);
  if (params['mode'] === 'definitions') {
    return { definitions: actionService.listDefinitions() };
  }
  return actionService.list(ctx, params);
});

/**
 * POST /api/v1/actions
 * Body: { type, name?, description?, configuration?, requiresApproval?, enabled? }
 */
export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx) => {
    return actionService.create(ctx, await readJson(request));
  },
);
