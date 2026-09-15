import { createApiHandler, readJson, searchParamsRecord } from '@/lib/api';
import { customFieldDefinitionService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  const query = searchParamsRecord(request);
  return customFieldDefinitionService.list(ctx, query.entityType);
});

export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin'] },
  async (request, ctx) => {
    return customFieldDefinitionService.create(ctx, await readJson(request));
  },
);
