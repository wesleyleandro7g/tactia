import type { ChatAnswer, ChatTurn } from '@tactia/ai';
import { logChatTurn } from '@tactia/ai';
import { sendMessageSchema } from '@tactia/domain';
import { AppError, ErrorCode, isAppError } from '@tactia/shared';
import { answerMetadata, getOrchestrator, toToolContext } from '@/lib/ai';
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
    const startedAt = Date.now();
    const conversationId = params['id']!;
    const { content, stream } = sendMessageSchema.parse(await readJson(request));

    const toolCtx = toToolContext(ctx);
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

    const orchestrator = getOrchestrator();

    if (!stream) {
      let answer: ChatAnswer;
      try {
        answer = await orchestrator.run({ ctx: toolCtx, question: content, history });
      } catch (error) {
        logChatTurn(ctx, { conversationId, startedAt, mode: 'sync', error });
        throw error;
      }

      const assistantMessage = await conversationService.appendMessage(ctx, conversationId, {
        role: 'assistant',
        content: answer.content,
        metadata: answerMetadata(answer),
      });
      logChatTurn(ctx, { conversationId, startedAt, mode: 'sync', answer });

      return {
        userMessage,
        message: assistantMessage,
        answer: {
          content: answer.content,
          followUps: answer.followUps,
          sources: answer.sources,
          toolCalls: answer.toolCalls,
          proposals: answer.proposals,
          attachments: answer.attachments,
          provider: answer.provider,
          model: answer.model,
          ...(answer.guardrail ? { guardrail: answer.guardrail } : {}),
        },
      };
    }

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (payload: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

        try {
          send({ type: 'start', conversationId, userMessageId: userMessage.id });

          let answer: ChatAnswer | null = null;
          for await (const event of orchestrator.stream({
            ctx: toolCtx,
            question: content,
            history,
          })) {
            if (event.type === 'done') {
              answer = event.answer;
              continue;
            }
            send(event);
          }

          if (answer) {
            const assistantMessage = await conversationService.appendMessage(ctx, conversationId, {
              role: 'assistant',
              content: answer.content,
              metadata: answerMetadata(answer),
            });
            send({
              type: 'done',
              messageId: assistantMessage.id,
              content: answer.content,
              followUps: answer.followUps,
              sources: answer.sources,
              toolCalls: answer.toolCalls.map((call) => ({ name: call.name, input: call.input })),
              proposals: answer.proposals,
              attachments: answer.attachments,
              provider: answer.provider,
              model: answer.model,
              ...(answer.guardrail ? { guardrail: answer.guardrail } : {}),
            });
          }
          logChatTurn(ctx, { conversationId, startedAt, mode: 'stream', answer });
        } catch (error) {
          const appError = isAppError(error)
            ? error
            : new AppError(ErrorCode.AI_ERROR, 'Falha ao gerar a resposta');
          logChatTurn(ctx, { conversationId, startedAt, mode: 'stream', error });
          send({ type: 'error', code: appError.code, message: appError.message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  },
);
