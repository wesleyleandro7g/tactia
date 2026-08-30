import { createApiHandler, readJson, searchParamsRecord } from '@/lib/api';
import { dataSourceService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx, params) => {
  return dataSourceService.listMappings(ctx, params.id ?? '', searchParamsRecord(request));
});

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (request, ctx, params) => {
    const body = await readJson(request);
    return dataSourceService.createMapping(ctx, params.id ?? '', body);
  },
);
