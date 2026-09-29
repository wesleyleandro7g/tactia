import { createApiHandler, searchParamsRecord } from '@/lib/api';
import { getCommandCenterMetrics } from '@/lib/command-center-metrics';

export const GET = createApiHandler({ auth: 'operator' }, (request, ctx, params) =>
  getCommandCenterMetrics(ctx, params['id'] ?? '', searchParamsRecord(request)),
);
