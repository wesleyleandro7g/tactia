import { createApiHandler } from '@/lib/api';
import { conversationService } from '@/lib/services';

/**
 * GET /api/v1/conversations/:id
 * Conversation + full message history (with sources in each message metadata).
 */
export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return conversationService.get(ctx, params['id']!);
});
