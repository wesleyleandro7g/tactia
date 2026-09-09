import { createApiHandler, readJson, searchParamsRecord } from '@/lib/api';
import { interactionService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  return interactionService.list(ctx, searchParamsRecord(request));
});

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (request, ctx) => {
    const body = await readJson(request);
    return interactionService.create(ctx, body);
  },
);
