import { createApiHandler, readJson } from '@/lib/api';
import { playbookService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx) => {
  return playbookService.list(ctx);
});

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (request, ctx) => {
    const body = await readJson(request);
    return playbookService.create(ctx, body);
  },
);
