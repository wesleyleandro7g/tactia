import { createApiHandler, readJson, searchParamsRecord } from '@/lib/api';
import { membershipService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  return membershipService.list(ctx, searchParamsRecord(request));
});

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx) => {
    const body = await readJson(request);
    return membershipService.create(ctx, body);
  },
);
