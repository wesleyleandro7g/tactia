import { createApiHandler } from '@/lib/api';
import { approvalService } from '@/lib/services';

export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return approvalService.get(ctx, params['id']!);
});
