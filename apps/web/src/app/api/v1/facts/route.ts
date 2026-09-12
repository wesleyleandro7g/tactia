import { createApiHandler, readJson } from '@/lib/api';
import { businessFactService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx) => {
  return businessFactService.listActive(ctx);
});

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (request, ctx) => {
    const body = await readJson(request);
    return businessFactService.create(ctx, body);
  },
);
