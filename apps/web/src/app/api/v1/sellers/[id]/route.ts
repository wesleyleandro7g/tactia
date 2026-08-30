import { createApiHandler, readJson } from '@/lib/api';
import { sellerService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return sellerService.get(ctx, params.id ?? '');
});

export const PATCH = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (request, ctx, params) => {
    const body = await readJson(request);
    return sellerService.update(ctx, params.id ?? '', body);
  },
);

export const DELETE = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (_request, ctx, params) => {
    return sellerService.remove(ctx, params.id ?? '');
  },
);
