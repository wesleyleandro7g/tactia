import { AppError, ErrorCode, isAppError, logger, redactSensitive, type RequestContext } from '@tactia/shared';
import type { ChatAnswer } from './types';

/**
 * Chat turn observability (spec §47). Never logs raw content — PII and
 * numeric claims stay out of the log line.
 */
export function logChatTurn(
  ctx: Pick<RequestContext, 'requestId' | 'tenantId' | 'userId' | 'operatorId'>,
  data: {
    /** `null` for ephemeral (non-persisted) sessions, e.g. the admin test chat. */
    conversationId: string | null;
    startedAt: number;
    mode: 'sync' | 'stream';
    answer?: ChatAnswer | null;
    error?: unknown;
  },
): void {
  const base = {
    request_id: ctx.requestId,
    tenant_id: ctx.tenantId,
    user_id: ctx.userId,
    ...(ctx.operatorId ? { operator_id: ctx.operatorId } : {}),
    operation: 'chat',
    conversation_id: data.conversationId ?? null,
    mode: data.mode,
    duration_ms: Date.now() - data.startedAt,
  };

  if (data.error) {
    const appError = isAppError(data.error)
      ? data.error
      : new AppError(ErrorCode.AI_ERROR, 'Falha ao gerar a resposta');
    logger.error({
      ...base,
      status: appError.statusCode,
      error: appError.code,
      message: redactSensitive(appError.message),
    });
    return;
  }

  logger.info({
    ...base,
    status: 200,
    provider: data.answer?.provider,
    model: data.answer?.model,
    tool_calls: data.answer?.toolCalls.length ?? 0,
    tool_names: data.answer?.toolCalls.map((call) => call.name) ?? [],
    sources: data.answer?.sources.length ?? 0,
    ...(data.answer?.guardrail ? { guardrail: data.answer.guardrail } : {}),
    ...(data.answer?.resolution ? { resolution: data.answer.resolution } : {}),
    recovery_attempts: data.answer?.recoveryAttempts ?? 0,
  });
}
