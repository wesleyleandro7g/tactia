import { createApiHandler } from '@/lib/api';
import { commandCenterService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx) => {
  return commandCenterService.listObjectives(ctx);
});
