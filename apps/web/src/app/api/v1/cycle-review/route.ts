import { createApiHandler, searchParamsRecord } from '@/lib/api';
import { commandCenterService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  return commandCenterService.getWeeklyCycleReview(ctx, searchParamsRecord(request));
});
