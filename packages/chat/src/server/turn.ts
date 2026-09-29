import { logChatTurn, type ChatAnswer, type ChatTurn, type ToolContext } from '@tactia/ai';
import { AppError, ErrorCode, createId, isAppError, type RequestContext } from '@tactia/shared';
import type { ChatRuntime } from './runtime';

/**
 * Persistence hooks for a chat turn. The web chat stores the assistant answer
 * in its conversation; the admin test chat omits them (ephemeral session).
 */
export type ChatTurnPersistence<TMessage extends { id: string } = { id: string }> = {
  conversationId: string;
  userMessageId: string;
  saveAnswer: (answer: ChatAnswer) => Promise<TMessage>;
};

export type RunChatTurnInput<TMessage extends { id: string }> = {
  runtime: Pick<ChatRuntime, 'getOrchestrator'>;
  /** Session context (logging). */
  ctx: RequestContext;
  /** Narrowed context handed to tools (see `toToolContext`). */
  toolCtx: ToolContext;
  question: string;
  history: ChatTurn[];
  persistence?: ChatTurnPersistence<TMessage>;
};

export type ChatTurnSyncResult<TMessage> = {
  /** Persisted assistant message; `null` for ephemeral sessions. */
  message: TMessage | null;
  answer: Omit<ReturnType<typeof publicAnswer>, 'toolCalls'> & { toolCalls: ChatAnswer['toolCalls'] };
};

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

/** Answer fields exposed to clients (sync body and the SSE `done` event). */
export function publicAnswer(answer: ChatAnswer) {
  return {
    content: answer.content,
    followUps: answer.followUps,
    sources: answer.sources,
    toolCalls: answer.toolCalls.map((call) => ({ name: call.name, input: call.input })),
    proposals: answer.proposals,
    attachments: answer.attachments,
    browserTaskIds: answer.browserTaskIds ?? [],
    provider: answer.provider,
    model: answer.model,
    ...(answer.guardrail ? { guardrail: answer.guardrail } : {}),
    ...(answer.resolution ? { resolution: answer.resolution } : {}),
  };
}

/** Runs one turn and returns the full answer (non-streaming clients). */
export async function runChatTurnSync<TMessage extends { id: string }>(
  input: RunChatTurnInput<TMessage>,
): Promise<ChatTurnSyncResult<TMessage>> {
  const startedAt = Date.now();
  const conversationId = input.persistence?.conversationId ?? null;
  let answer: ChatAnswer;
  try {
    answer = await input.runtime
      .getOrchestrator()
      .run({ ctx: input.toolCtx, question: input.question, history: input.history });
  } catch (error) {
    logChatTurn(input.ctx, { conversationId, startedAt, mode: 'sync', error });
    throw error;
  }
  const message = input.persistence ? await input.persistence.saveAnswer(answer) : null;
  logChatTurn(input.ctx, { conversationId, startedAt, mode: 'sync', answer });
  // The sync body keeps the full tool call records (duration, error), as before.
  return { message, answer: { ...publicAnswer(answer), toolCalls: answer.toolCalls } };
}

/**
 * Runs one turn as Server-Sent Events: `start`, tool/text events, then `done`
 * (or `error`). Errors never leak internals: unknown failures become AI_ERROR.
 */
export function streamChatTurn<TMessage extends { id: string }>(
  input: RunChatTurnInput<TMessage>,
): Response {
  const startedAt = Date.now();
  const conversationId = input.persistence?.conversationId ?? null;
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      try {
        send({
          type: 'start',
          conversationId,
          userMessageId: input.persistence?.userMessageId ?? `ephemeral-${createId()}`,
        });

        let answer: ChatAnswer | null = null;
        for await (const event of input.runtime.getOrchestrator().stream({
          ctx: input.toolCtx,
          question: input.question,
          history: input.history,
        })) {
          if (event.type === 'done') {
            answer = event.answer;
            continue;
          }
          send(event);
        }

        if (answer) {
          const message = input.persistence ? await input.persistence.saveAnswer(answer) : null;
          send({
            type: 'done',
            messageId: message?.id ?? `ephemeral-${createId()}`,
            ...publicAnswer(answer),
          });
        }
        logChatTurn(input.ctx, { conversationId, startedAt, mode: 'stream', answer });
      } catch (error) {
        const appError = isAppError(error)
          ? error
          : new AppError(ErrorCode.AI_ERROR, 'Falha ao gerar a resposta');
        logChatTurn(input.ctx, { conversationId, startedAt, mode: 'stream', error });
        send({ type: 'error', code: appError.code, message: appError.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, { status: 200, headers: SSE_HEADERS });
}
