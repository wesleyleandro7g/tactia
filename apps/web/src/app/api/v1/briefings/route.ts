import { createApiHandler } from '@/lib/api';
import { briefingService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx) => {
  return briefingService.list(ctx);
});

export const POST = createApiHandler({ auth: 'tenant' }, async (_request, ctx) => {
  return briefingService.generate(ctx);
});
