import { createApiHandler } from '@/lib/api';
import { briefingService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx) => {
  return briefingService.latest(ctx);
});
