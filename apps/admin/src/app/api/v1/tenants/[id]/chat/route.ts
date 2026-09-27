import { ephemeralTurnSchema } from '@tactia/chat/protocol';
import { streamChatTurn, toToolContext } from '@tactia/chat/server';
import { createApiHandler, readJson } from '@/lib/api';
import { chatRuntime, chatTenantContext } from '@/lib/chat';
import { RATE_LIMITS } from '@/lib/rate-limit';

/**
 * POST /api/v1/tenants/:id/chat — ephemeral test chat (operators only).
 * Body: { content, history? } — the client owns the history (last 12 turns).
 *
 * Nothing is persisted as a conversation. Tools run with the operator as
 * principal (`userId: null`, `operatorId` set, role owner), so their effects
 * (proposals, approvals, facts, infographics, browser tasks) are real and
 * audited as the operator. Response: Server-Sent Events.
 */
export const POST = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.chat },
  async (request, ctx, params) => {
    const tenantCtx = await chatTenantContext(ctx, params['id']!);
    const { content, history } = ephemeralTurnSchema.parse(await readJson(request));
    return streamChatTurn({
      runtime: chatRuntime,
      ctx: tenantCtx,
      toolCtx: toToolContext(tenantCtx),
      question: content,
      history,
    });
  },
);
