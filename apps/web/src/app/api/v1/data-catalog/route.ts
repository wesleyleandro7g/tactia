import { createApiHandler, searchParamsRecord } from '@/lib/api';
import { dataCatalogService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  const query = searchParamsRecord(request);
  return dataCatalogService.getCatalog(ctx, {
    entityType: query.entityType,
  });
});
