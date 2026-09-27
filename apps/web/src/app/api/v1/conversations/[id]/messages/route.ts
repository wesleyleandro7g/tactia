import type { ChatTurn } from '@tactia/ai';
import { runChatTurnSync, streamChatTurn } from '@tactia/chat/server';
import { sendMessageSchema } from '@tactia/domain';
import { answerMetadata, chatRuntime, toToolContext } from '@/lib/ai';
import { createApiHandler, readJson } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { conversationService } from '@/lib/services';

const HISTORY_TURNS = 12;

/**
 * GET /api/v1/conversations/:id/messages
 * Full history; assistant messages carry `metadata.sources` (spec §43).
 */
export const GET = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  return { items: await conversationService.listMessages(ctx, params['id']!) };
});

/**
 * POST /api/v1/conversations/:id/messages
 * Body: { content: string, stream?: boolean }
 *
 * Persists the user message, runs the orchestrator (context → tools → answer)
 * and persists the assistant answer together with its evidence. With
 * `stream: true` the answer is streamed as Server-Sent Events.
 */
export const POST = createApiHandler(
  { auth: 'tenant', rateLimit: RATE_LIMITS.chat },
  async (request, ctx, params) => {
    const conversationId = params['id']!;
    const { content, stream } = sendMessageSchema.parse(await readJson(request));

    const toolCtx = { ...toToolContext(ctx), conversationId };
    await conversationService.requireConversation(ctx, conversationId);

    // History is read before the new message is stored.
    const previous = await conversationService.recentMessages(ctx, conversationId, HISTORY_TURNS);
    const history: ChatTurn[] = previous
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({ role: message.role as ChatTurn['role'], content: message.content }));

    const userMessage = await conversationService.appendMessage(ctx, conversationId, {
      role: 'user',
      content,
    });
    await conversationService.renameFromFirstMessage(ctx, conversationId, content);

    const turn = {
      runtime: chatRuntime,
      ctx,
      toolCtx,
      question: content,
      history,
      persistence: {
        conversationId,
        userMessageId: userMessage.id,
        saveAnswer: (answer: Parameters<typeof answerMetadata>[0]) =>
          conversationService.appendMessage(ctx, conversationId, {
            role: 'assistant',
            content: answer.content,
            metadata: answerMetadata(answer),
          }),
      },
    };

    if (!stream) {
      const result = await runChatTurnSync(turn);
      return { userMessage, message: result.message, answer: result.answer };
    }

    return streamChatTurn(turn);
  },
);
