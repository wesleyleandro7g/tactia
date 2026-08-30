import { createApiHandler, readJson, searchParamsRecord } from '@/lib/api';
import { sellerService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  return sellerService.list(ctx, searchParamsRecord(request));
});

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (request, ctx) => {
    const body = await readJson(request);
    return sellerService.create(ctx, body);
  },
);
