import { createApiHandler, readJson } from '@/lib/api';
import { customerService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return customerService.get(ctx, params.id ?? '');
});

export const PATCH = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (request, ctx, params) => {
    const body = await readJson(request);
    return customerService.update(ctx, params.id ?? '', body);
  },
);

export const DELETE = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (_request, ctx, params) => {
    return customerService.remove(ctx, params.id ?? '');
  },
);
