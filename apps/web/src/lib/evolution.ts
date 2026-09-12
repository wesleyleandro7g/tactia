import { timingSafeEqual } from 'node:crypto';
import { logger } from '@tactia/shared';
import { normalizeWhatsappPhone } from '@tactia/domain';

const WHATSAPP_CHUNK = 3500;

export type EvolutionConfig = {
  apiUrl: string;
  apiKey: string;
  instance: string;
  webhookSecret: string;
};

export type ParsedEvolutionInbound = {
  event: string;
  fromMe: boolean;
  isGroup: boolean;
  phone: string | null;
  messageId: string | null;
  text: string | null;
  apikey: string | null;
};

export function getEvolutionConfig(): EvolutionConfig | null {
  const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  const instance = process.env.EVOLUTION_INSTANCE?.trim();
  const webhookSecret =
    process.env.EVOLUTION_WEBHOOK_SECRET?.trim() || apiKey;
  if (!apiUrl || !apiKey || !instance || !webhookSecret) return null;
  return { apiUrl, apiKey, instance, webhookSecret };
}

export function evolutionSecretMatches(
  provided: string | null | undefined,
  expected: string,
): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function splitWhatsappChunks(text: string, max = WHATSAPP_CHUNK): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= max) return [trimmed];

  const chunks: string[] = [];
  let remaining = trimmed;
  while (remaining.length > max) {
    let cut = remaining.lastIndexOf('\n', max);
    if (cut < max / 2) cut = remaining.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeEvent(raw: string | null): string {
  if (!raw) return '';
  return raw.trim().toUpperCase().replace(/[.-]/g, '_');
}

function extractText(message: Record<string, unknown> | null): string | null {
  if (!message) return null;
  const conversation = asString(message.conversation);
  if (conversation) return conversation.trim();

  const extended = asRecord(message.extendedTextMessage);
  const extendedText = asString(extended?.text);
  if (extendedText) return extendedText.trim();

  for (const key of ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage']) {
    const media = asRecord(message[key]);
    const caption = asString(media?.caption)?.trim();
    if (caption) return caption;
  }
  return null;
}

function phoneFromJid(jid: string | null): string | null {
  if (!jid) return null;
  return normalizeWhatsappPhone(jid);
}

export function parseEvolutionWebhook(payload: unknown): ParsedEvolutionInbound | null {
  const root = asRecord(payload);
  if (!root) return null;

  const dataRaw = root.data;
  const data = Array.isArray(dataRaw) ? asRecord(dataRaw[0]) : asRecord(dataRaw);
  if (!data) {
    return {
      event: normalizeEvent(asString(root.event)),
      fromMe: false,
      isGroup: false,
      phone: null,
      messageId: null,
      text: null,
      apikey: asString(root.apikey),
    };
  }

  const key = asRecord(data.key);
  const remoteJid = asString(key?.remoteJid);
  const phone =
    phoneFromJid(remoteJid) ??
    phoneFromJid(asString(key?.remoteJidAlt)) ??
    phoneFromJid(asString(data.senderPn)) ??
    phoneFromJid(asString(root.sender));

  return {
    event: normalizeEvent(asString(root.event)),
    fromMe: key?.fromMe === true,
    isGroup: Boolean(remoteJid?.endsWith('@g.us')),
    phone,
    messageId: asString(key?.id),
    text: extractText(asRecord(data.message)),
    apikey: asString(root.apikey),
  };
}

export function inboundSkipReason(inbound: ParsedEvolutionInbound): string | null {
  if (inbound.event !== 'MESSAGES_UPSERT') return 'event';
  if (inbound.fromMe) return 'fromMe';
  if (inbound.isGroup) return 'group';
  if (!inbound.phone) return 'phone';
  if (!inbound.text) return 'text';
  if (!inbound.messageId) return 'messageId';
  return null;
}

export async function sendWhatsappText(number: string, text: string): Promise<void> {
  const config = getEvolutionConfig();
  if (!config) {
    logger.warn({ number }, 'Evolution API is not configured; skip send');
    return;
  }

  const chunks = splitWhatsappChunks(text);
  for (const chunk of chunks) {
    const response = await fetch(
      `${config.apiUrl}/message/sendText/${encodeURIComponent(config.instance)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: config.apiKey,
        },
        body: JSON.stringify({ number, text: chunk }),
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.error(
        { status: response.status, body: body.slice(0, 500), number },
        'Evolution sendText failed',
      );
      throw new Error(`Evolution sendText failed with ${response.status}`);
    }
  }
}
