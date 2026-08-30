import { createApiHandler, readJson, searchParamsRecord } from '@/lib/api';
import { conversationService } from '@/lib/services';

/**
 * GET /api/v1/conversations
 * Lists the conversations of the current user (query: page, pageSize).
 */
export const GET = createApiHandler({ auth: 'tenant' }, async (request, ctx) => {
  return conversationService.list(ctx, searchParamsRecord(request));
});

/**
 * POST /api/v1/conversations
 * Body: { title?: string }
 * The title is derived from the first message when omitted.
 */
export const POST = createApiHandler(
  { auth: 'tenant', roles: ['owner', 'admin', 'member'] },
  async (request, ctx) => {
    const body = await readJson(request).catch(() => ({}));
    return conversationService.create(ctx, body ?? {});
  },
);
