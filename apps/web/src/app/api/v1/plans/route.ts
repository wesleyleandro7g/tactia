import { createApiHandler, readJson } from '@/lib/api';
import { commandCenterService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  const search = new URL(request.url).searchParams;
  return commandCenterService.listPlans(ctx, {
    status: search.get('status') ?? undefined,
  });
});

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx) => commandCenterService.createPlan(ctx, await readJson(request)),
);
