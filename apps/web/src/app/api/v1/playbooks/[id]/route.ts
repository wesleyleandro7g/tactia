import { createApiHandler, readJson } from '@/lib/api';
import { playbookService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return playbookService.get(ctx, params.id ?? '');
});

export const PATCH = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (request, ctx, params) => {
    return playbookService.update(ctx, params.id ?? '', await readJson(request));
  },
);

export const DELETE = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (_request, ctx, params) => {
    return playbookService.remove(ctx, params.id ?? '');
  },
);
