import { after } from 'next/server';
import { createId, logger } from '@tactia/shared';
import {
  evolutionSecretMatches,
  getEvolutionConfig,
  inboundSkipReason,
  parseEvolutionWebhook,
} from '@/lib/evolution';
import { handleWhatsappInbound } from '@/lib/whatsapp-chat';

export const maxDuration = 60;

/**
 * Evolution API webhook. Always 200 so the provider does not retry.
 * LLM + reply run in `after()` so the ACK is fast.
 */
export async function POST(request: Request) {
  const requestId = createId();
  const log = logger.child({ requestId, provider: 'evolution' });

  try {
    const payload = (await request.json()) as unknown;
    const inbound = parseEvolutionWebhook(payload);
    const headerKey = request.headers.get('apikey');
    const provided = headerKey || inbound?.apikey || null;

    after(() => processInbound({ inbound, provided, requestId }));
  } catch (err) {
    log.error({ err }, 'Failed to parse Evolution webhook');
  }

  return Response.json({ ok: true, requestId });
}

async function processInbound(input: {
  inbound: ReturnType<typeof parseEvolutionWebhook>;
  provided: string | null;
  requestId: string;
}) {
  const log = logger.child({ requestId: input.requestId, provider: 'evolution' });
  const config = getEvolutionConfig();
  if (!config) {
    log.info('Evolution webhook skipped: not configured');
    return;
  }
  if (!evolutionSecretMatches(input.provided, config.webhookSecret)) {
    log.warn('Evolution webhook skipped: invalid apikey');
    return;
  }
  if (!input.inbound) {
    log.info('Evolution webhook skipped: empty payload');
    return;
  }
  const skip = inboundSkipReason(input.inbound);
  if (skip) {
    log.info({ skip, event: input.inbound.event }, 'Evolution webhook ignored');
    return;
  }

  try {
    await handleWhatsappInbound({
      phone: input.inbound.phone!,
      text: input.inbound.text!,
      messageId: input.inbound.messageId!,
      requestId: input.requestId,
    });
  } catch (err) {
    log.error({ err }, 'Evolution webhook processing failed');
  }
}
