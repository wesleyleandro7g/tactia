import { createApiHandler, searchParamsRecord } from '@/lib/api';
import { syncService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  return syncService.listSyncJobs(ctx, searchParamsRecord(request));
});
