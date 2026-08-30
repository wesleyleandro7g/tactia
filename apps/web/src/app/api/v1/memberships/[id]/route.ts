import { createApiHandler, readJson } from '@/lib/api';
import { membershipService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return membershipService.get(ctx, params.id ?? '');
});

export const PATCH = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx, params) => {
    const body = await readJson(request);
    return membershipService.update(ctx, params.id ?? '', body);
  },
);

export const DELETE = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (_request, ctx, params) => {
    await membershipService.remove(ctx, params.id ?? '');
    return { ok: true };
  },
);
