import type { ChatAnswer, ChatTurn, WhatsappChannelContext } from '@tactia/ai';
import { logChatTurn } from '@tactia/ai';
import { ErrorCode, createId, isAppError, logger, type RequestContext } from '@tactia/shared';
import { answerMetadata, getClassifierAdapter, getOrchestrator, toToolContext } from '@/lib/ai';
import { sendWhatsappImage, sendWhatsappText } from '@/lib/evolution';
import { enqueueWhatsappAgentJob } from '@/lib/jobs';
import { consumeRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  conversationService,
  infographicService,
  whatsappAgentConfigService,
  whatsappAgentJobService,
  whatsappAuthorizedNumberService,
} from '@/lib/services';
import {
  classifyWhatsappMessage,
  confirmationMessage,
  detectCancellation,
} from '@/lib/whatsapp-agent';

const HISTORY_TURNS = 12;
const NEW_THREAD_COMMAND = /^\/nova$/i;
const RATE_LIMIT_REPLY =
  'Muitas mensagens em pouco tempo. Aguarde um instante e tente novamente.';
const ERROR_REPLY = 'Não consegui gerar a resposta agora. Tente de novo em instantes.';
const NEW_THREAD_REPLY = 'Nova conversa iniciada. Pode perguntar.';
const CANCELLED_REPLY = 'Ação cancelada. Não vou concluir o que estava em andamento.';
const NOTHING_TO_CANCEL_REPLY = 'Não há nenhuma ação em andamento para cancelar.';

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

  // Cancellation wins over everything else: if there is an in-flight job for
  // this number, cancel it immediately (spec §3). Cooperative: the worker
  // honors the flipped status around the orchestrator run.
  if (detectCancellation(text)) {
    const active = await whatsappAgentJobService.findActiveByNumber({
      tenantId: number.tenantId,
      numberId: number.id,
    });
    if (active) {
      await whatsappAgentJobService.requestCancel({ tenantId: number.tenantId, id: active.id });
      logger.info(
        { tenant_id: number.tenantId, job_id: active.id, operation: 'wa_job_cancel_requested' },
        'WhatsApp job cancellation requested',
      );
      await sendWhatsappText(input.phone, CANCELLED_REPLY);
    } else {
      await sendWhatsappText(input.phone, NOTHING_TO_CANCEL_REPLY);
    }
    return;
  }

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

  const channel = await buildChannelContext(number.tenantId, number);

  // Route read vs. operation. Operations are confirmed immediately and executed
  // asynchronously with a final status reply (spec §2.2, §3.1).
  const classifier = getClassifierAdapter();
  const intent = classifier
    ? await classifyWhatsappMessage(classifier, text)
    : { kind: 'read' as const, plan: null };

  if (intent.kind === 'operation') {
    const job = await whatsappAgentJobService.enqueue({
      tenantId: number.tenantId,
      numberId: number.id,
      userId: number.userId,
      conversationId,
      requestText: text,
      plan: intent.plan,
      messageId: input.messageId,
    });
    await sendWhatsappText(input.phone, confirmationMessage(intent.plan));
    await enqueueWhatsappAgentJob({ tenantId: number.tenantId, jobId: job.id });
    logger.info(
      { tenant_id: number.tenantId, job_id: job.id, operation: 'wa_job_enqueued' },
      'WhatsApp operation enqueued',
    );
    return;
  }

  let answer: ChatAnswer;
  try {
    answer = await getOrchestrator().run({
      ctx: toToolContext(ctx),
      question: text,
      history,
      channel,
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

  for (const attachment of answer.attachments) {
    try {
      const asset = await infographicService.getBytes(ctx, attachment.id);
      await sendWhatsappImage({
        number: input.phone,
        imageBase64: asset.body.toString('base64'),
        mimetype: asset.contentType,
        caption: attachment.title,
        fileName: 'infographic.png',
      });
    } catch (error) {
      logger.error({ err: error, attachmentId: attachment.id }, 'WhatsApp infographic send failed');
    }
  }

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

/** Per-company tone/context + this contact's name/role for the system prompt. */
async function buildChannelContext(
  tenantId: string,
  number: { contactName?: string | null; contactRole?: string | null },
): Promise<WhatsappChannelContext> {
  const config = await whatsappAgentConfigService.getForChannel(tenantId).catch(() => null);
  return {
    tone: config?.tone ?? null,
    instructions: config?.instructions ?? null,
    companyContext: config?.companyContext ?? null,
    contactName: number.contactName ?? null,
    contactRole: number.contactRole ?? null,
  };
}
