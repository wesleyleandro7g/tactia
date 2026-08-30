import { createApiHandler } from '@/lib/api';
import { dataSourceService } from '@/lib/services';

export const POST = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return dataSourceService.discover(ctx, params.id ?? '');
});
