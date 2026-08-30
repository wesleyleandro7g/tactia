import { createApiHandler, readJson } from '@/lib/api';
import { userService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return userService.get(ctx, params.id ?? '');
});

export const PATCH = createApiHandler({ auth: 'tenant' }, async (request, ctx, params) => {
  const body = await readJson(request);
  return userService.update(ctx, params.id ?? '', body);
});
