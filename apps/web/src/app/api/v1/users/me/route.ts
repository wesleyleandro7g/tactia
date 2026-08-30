import { createApiHandler } from '@/lib/api';
import { userService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'user' }, async (_request, ctx) => {
  return userService.getMe(ctx);
});
