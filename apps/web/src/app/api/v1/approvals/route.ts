import { createApiHandler, searchParamsRecord } from '@/lib/api';
import { approvalService } from '@/lib/services';

/**
 * GET /api/v1/approvals
 * Approval queue. Defaults to `status=pending` (query: status, page, pageSize).
 */
export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  return approvalService.list(ctx, searchParamsRecord(request));
});
