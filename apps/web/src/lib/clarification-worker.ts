import { logger } from '@tactia/shared';
import { sendWhatsappText } from '@/lib/evolution';
import { evidenceClarificationService } from '@/lib/services';

/**
 * Sends one prepared clarification. The gap and the contact policy are checked
 * again at send time: a gap resolved meanwhile cancels the question, and a
 * budget/window violation fails it without contacting the person.
 */
export async function runEvidenceClarificationJob(
  tenantId: string,
  clarificationId: string,
): Promise<void> {
  const claim = await evidenceClarificationService.claimForSend(tenantId, clarificationId);

  if (claim.status !== 'ready') {
    logger.info({
      tenant_id: tenantId,
      clarification_id: clarificationId,
      operation: 'clarification_not_sent',
      status: claim.status,
      ...(claim.status === 'blocked' ? { reason: claim.reason } : {}),
    });
    return;
  }

  const { clarification } = claim;
  try {
    await sendWhatsappText(clarification.number.phone, clarification.question);
    await evidenceClarificationService.markSent(tenantId, clarificationId);
    logger.info({
      tenant_id: tenantId,
      clarification_id: clarificationId,
      gap_id: clarification.gapId,
      operation: 'clarification_sent',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'send failed';
    await evidenceClarificationService.markFailed(tenantId, clarificationId, message);
    logger.error({
      tenant_id: tenantId,
      clarification_id: clarificationId,
      operation: 'clarification_send_failed',
      error: message,
    });
  }
}
