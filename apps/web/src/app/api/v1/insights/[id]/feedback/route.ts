import { createApiHandler, readJson } from '@/lib/api';
import { insightFeedbackService } from '@/lib/services';

export const POST = createApiHandler({ auth: 'tenant' }, async (request, ctx, params) => {
  const body = await readJson(request);
  return insightFeedbackService.upsert(ctx, params['id']!, body);
});
