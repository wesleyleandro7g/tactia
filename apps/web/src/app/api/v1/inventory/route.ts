import { createApiHandler } from '@/lib/api';
import { inventoryService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx) => {
  return inventoryService.list(ctx);
});
