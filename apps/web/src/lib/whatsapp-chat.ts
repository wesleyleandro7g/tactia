import type { ChatAnswer, ChatTurn } from '@tactia/ai';
import { logChatTurn } from '@tactia/ai';
import { ErrorCode, createId, isAppError, logger, type RequestContext } from '@tactia/shared';
import { answerMetadata, getOrchestrator, toToolContext } from '@/lib/ai';
import { sendWhatsappText } from '@/lib/evolution';
import { consumeRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { conversationService, whatsappAuthorizedNumberService } from '@/lib/services';

const HISTORY_TURNS = 12;
const NEW_THREAD_COMMAND = /^\/nova$/i;
const RATE_LIMIT_REPLY =
  'Muitas mensagens em pouco tempo. Aguarde um instante e tente novamente.';
const ERROR_REPLY = 'Não consegui gerar a resposta agora. Tente de novo em instantes.';
const NEW_THREAD_REPLY = 'Nova conversa iniciada. Pode perguntar.';

export async function handleWhatsappInbound(input: {
  phone: string;
  text: string;
  messageId: string;
  requestId?: string;
}): Promise<void> {
  const inbound = await whatsappAuthorizedNumberService.resolveActiveInbound(input.phone);
  if (!inbound) {
    logger.info({ phone: input.phone }, 'WhatsApp inbound ignored: unauthorized');
    return;
  }

  const { number, role } = inbound;
  if (number.lastInboundMessageId && number.lastInboundMessageId === input.messageId) {
    logger.info({ messageId: input.messageId }, 'WhatsApp inbound ignored: duplicate');
    return;
  }

  const ctx: RequestContext = {
    requestId: input.requestId ?? createId(),
    tenantId: number.tenantId,
    userId: number.userId,
    role,
    ip: null,
  };

  if (!consumeRateLimit(`chat:wa:${number.id}`, RATE_LIMITS.chat.limit, RATE_LIMITS.chat.windowMs)) {
    await sendWhatsappText(input.phone, RATE_LIMIT_REPLY);
    return;
  }

  const text = input.text.trim().slice(0, 4000);

  if (NEW_THREAD_COMMAND.test(text)) {
    const conversation = await conversationService.create(ctx, { title: 'WhatsApp' });
    await whatsappAuthorizedNumberService.bindInbound({
      tenantId: number.tenantId,
      id: number.id,
      conversationId: conversation.id,
      messageId: input.messageId,
    });
    await sendWhatsappText(input.phone, NEW_THREAD_REPLY);
    return;
  }

  const conversationId = await resolveConversationId(ctx, number.conversationId, text);
  await whatsappAuthorizedNumberService.bindInbound({
    tenantId: number.tenantId,
    id: number.id,
    conversationId,
    messageId: input.messageId,
  });

  const startedAt = Date.now();
  const previous = await conversationService.recentMessages(ctx, conversationId, HISTORY_TURNS);
  const history: ChatTurn[] = previous
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role as ChatTurn['role'], content: message.content }));

  await conversationService.appendMessage(ctx, conversationId, {
    role: 'user',
    content: text,
    metadata: { source: 'whatsapp', evolutionMessageId: input.messageId },
  });
  await conversationService.renameFromFirstMessage(ctx, conversationId, text);

  let answer: ChatAnswer;
  try {
    answer = await getOrchestrator().run({
      ctx: toToolContext(ctx),
      question: text,
      history,
    });
  } catch (error) {
    logChatTurn(ctx, { conversationId, startedAt, mode: 'sync', error });
    await sendWhatsappText(input.phone, whatsappErrorReply(error));
    return;
  }

  await conversationService.appendMessage(ctx, conversationId, {
    role: 'assistant',
    content: answer.content,
    metadata: { ...answerMetadata(answer), source: 'whatsapp' },
  });
  logChatTurn(ctx, { conversationId, startedAt, mode: 'sync', answer });
  await sendWhatsappText(input.phone, answer.content || ERROR_REPLY);
}

async function resolveConversationId(
  ctx: RequestContext,
  currentId: string | null,
  firstMessage: string,
): Promise<string> {
  if (currentId) {
    try {
      await conversationService.requireConversation(ctx, currentId);
      return currentId;
    } catch (error) {
      if (!isAppError(error) || error.code !== ErrorCode.NOT_FOUND) throw error;
    }
  }
  const conversation = await conversationService.create(ctx, {}, firstMessage);
  return conversation.id;
}

function whatsappErrorReply(error: unknown): string {
  if (isAppError(error) && error.code === ErrorCode.RATE_LIMITED) return RATE_LIMIT_REPLY;
  return ERROR_REPLY;
}
