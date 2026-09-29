import { createApiHandler, searchParamsRecord } from '@/lib/api';
import { evidenceGapService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'operator' }, async (request, ctx) => {
  return evidenceGapService.list(ctx, searchParamsRecord(request));
});
