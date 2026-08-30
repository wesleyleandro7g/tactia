import { createApiHandler, readJson } from '@/lib/api';
import { dataSourceService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return dataSourceService.getMapping(ctx, params.id ?? '', params.mappingId ?? '');
});

export const PATCH = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (request, ctx, params) => {
    const body = await readJson(request);
    return dataSourceService.updateMapping(ctx, params.id ?? '', params.mappingId ?? '', body);
  },
);

export const DELETE = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (_request, ctx, params) => {
    return dataSourceService.deleteMapping(ctx, params.id ?? '', params.mappingId ?? '');
  },
);
