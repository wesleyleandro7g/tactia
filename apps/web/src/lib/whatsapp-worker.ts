import type { ChatAnswer, ChatTurn, WhatsappChannelContext } from '@tactia/ai';
import { logChatTurn } from '@tactia/ai';
import { createId, logger, type RequestContext } from '@tactia/shared';
import { answerMetadata, getOrchestrator, toToolContext } from '@/lib/ai';
import { sendWhatsappImage, sendWhatsappText } from '@/lib/evolution';
import {
  conversationService,
  infographicService,
  whatsappAgentConfigService,
  whatsappAgentJobService,
} from '@/lib/services';

const HISTORY_TURNS = 12;
const FAILURE_REPLY =
  'Não consegui concluir a ação agora. Pode tentar de novo em instantes ou reformular o pedido?';

/**
 * Executes one WhatsApp agent job: runs the same orchestrator as the web chat
 * (with write tools executing directly, no approval gate on this channel) and
 * sends the final status message. Honors a cancellation requested meanwhile.
 */
export async function runWhatsappAgentJob(tenantId: string, jobId: string): Promise<void> {
  const job = await whatsappAgentJobService.findById({ tenantId, id: jobId });
  if (!job) {
    logger.warn({ tenant_id: tenantId, job_id: jobId, operation: 'wa_job_missing' });
    return;
  }
  if (job.status === 'cancelled') {
    logger.info({ tenant_id: tenantId, job_id: jobId, operation: 'wa_job_cancelled_pre' });
    return;
  }

  // The job stores numberId; resolve the number + membership through the repo path.
  const resolved = await resolveNumber(tenantId, job.numberId);
  if (!resolved) {
    logger.warn({ tenant_id: tenantId, job_id: jobId, operation: 'wa_job_number_missing' });
    await whatsappAgentJobService.markFailed({ tenantId, id: jobId, error: 'number not found' });
    return;
  }

  const running = await whatsappAgentJobService.markRunning({ tenantId, id: jobId });
  if (!running) {
    // Either already running or was cancelled between enqueue and pickup.
    logger.info({ tenant_id: tenantId, job_id: jobId, operation: 'wa_job_not_runnable' });
    return;
  }

  const ctx: RequestContext = {
    requestId: createId(),
    tenantId,
    userId: job.userId,
    role: resolved.role,
    ip: null,
  };

  const channel = await buildChannel(tenantId, resolved);
  const startedAt = Date.now();

  let answer: ChatAnswer;
  try {
    const previous = job.conversationId
      ? await conversationService.recentMessages(ctx, job.conversationId, HISTORY_TURNS)
      : [];
    const history: ChatTurn[] = previous
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({ role: message.role as ChatTurn['role'], content: message.content }));

    answer = await getOrchestrator().run({
      ctx: toToolContext(ctx),
      question: job.requestText,
      history,
      channel,
    });
  } catch (error) {
    logChatTurn(ctx, { conversationId: job.conversationId ?? '', startedAt, mode: 'sync', error });
    await whatsappAgentJobService.markFailed({
      tenantId,
      id: jobId,
      error: error instanceof Error ? error.message : 'orchestrator failed',
    });
    if (await stillActive(tenantId, jobId)) {
      await sendWhatsappText(resolved.phone, FAILURE_REPLY);
    }
    return;
  }

  // A cancel requested during the run wins: do not persist or notify success.
  if (await wasCancelled(tenantId, jobId)) {
    logger.info({ tenant_id: tenantId, job_id: jobId, operation: 'wa_job_cancelled_mid' });
    return;
  }

  if (job.conversationId) {
    await conversationService.appendMessage(ctx, job.conversationId, {
      role: 'assistant',
      content: answer.content,
      metadata: { ...answerMetadata(answer), source: 'whatsapp', jobId },
    });
  }
  logChatTurn(ctx, { conversationId: job.conversationId ?? '', startedAt, mode: 'sync', answer });

  for (const attachment of answer.attachments) {
    try {
      const asset = await infographicService.getBytes(ctx, attachment.id);
      await sendWhatsappImage({
        number: resolved.phone,
        imageBase64: asset.body.toString('base64'),
        mimetype: asset.contentType,
        caption: attachment.title,
        fileName: 'infographic.png',
      });
    } catch (error) {
      logger.error({ err: error, attachmentId: attachment.id }, 'WhatsApp infographic send failed');
    }
  }

  await whatsappAgentJobService.markDone({ tenantId, id: jobId });
  await sendWhatsappText(resolved.phone, answer.content || FAILURE_REPLY);
}

type ResolvedNumber = {
  phone: string;
  role: RequestContext['role'];
  contactName: string | null;
  contactRole: string | null;
};

async function resolveNumber(tenantId: string, numberId: string): Promise<ResolvedNumber | null> {
  const { prisma } = await import('@tactia/database');
  const number = await prisma.whatsappAuthorizedNumber.findFirst({
    where: { id: numberId, tenantId, disabledAt: null },
  });
  if (!number) return null;
  const membership = await prisma.membership.findFirst({
    where: { tenantId, userId: number.userId, status: 'active' },
  });
  if (!membership) return null;
  return {
    phone: number.phone,
    role: membership.role as RequestContext['role'],
    contactName: number.contactName,
    contactRole: number.contactRole,
  };
}

async function buildChannel(
  tenantId: string,
  number: ResolvedNumber,
): Promise<WhatsappChannelContext> {
  const config = await whatsappAgentConfigService.getForChannel(tenantId).catch(() => null);
  return {
    tone: config?.tone ?? null,
    instructions: config?.instructions ?? null,
    companyContext: config?.companyContext ?? null,
    contactName: number.contactName,
    contactRole: number.contactRole,
  };
}

async function wasCancelled(tenantId: string, jobId: string): Promise<boolean> {
  const fresh = await whatsappAgentJobService.findById({ tenantId, id: jobId });
  return fresh?.status === 'cancelled';
}

async function stillActive(tenantId: string, jobId: string): Promise<boolean> {
  const fresh = await whatsappAgentJobService.findById({ tenantId, id: jobId });
  return fresh?.status === 'running' || fresh?.status === 'failed';
}
