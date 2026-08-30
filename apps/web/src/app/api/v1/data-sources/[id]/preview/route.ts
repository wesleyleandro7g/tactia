import { createApiHandler, readJson } from '@/lib/api';
import { dataSourceService } from '@/lib/services';

export const POST = createApiHandler({ auth: 'tenant' }, async (request, ctx, params) => {
  const body = (await readJson(request)) as { resource?: string; limit?: number };
  return dataSourceService.preview(ctx, params.id ?? '', body.resource ?? 'data', body.limit ?? 20);
});
