import { createApiHandler, searchParamsRecord } from '@/lib/api';
import { importService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  return importService.list(ctx, searchParamsRecord(request));
});
