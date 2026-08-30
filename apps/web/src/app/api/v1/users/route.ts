import { createApiHandler, readJson, searchParamsRecord } from '@/lib/api';
import { userService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  return userService.list(ctx, searchParamsRecord(request));
});

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx) => {
    const body = await readJson(request);
    return userService.create(ctx, body);
  },
);
