import { createApiHandler } from '@/lib/api';
import { backofficeService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'operator' }, async (_request, ctx) => {
  return backofficeService.listDataSourceKinds(ctx);
});
