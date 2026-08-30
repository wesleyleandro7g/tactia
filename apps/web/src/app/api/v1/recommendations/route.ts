import { createApiHandler, searchParamsRecord } from '@/lib/api';
import { recommendationService } from '@/lib/services';

/**
 * GET /api/v1/recommendations
 * Query: status, page, pageSize
 */
export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  return recommendationService.list(ctx, searchParamsRecord(request));
});
