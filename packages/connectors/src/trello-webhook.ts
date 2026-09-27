import { createHmac, timingSafeEqual } from 'node:crypto';

const PERSONAL_KEYS = new Set(['email', 'avatarUrl', 'avatarHash', 'fullName', 'username', 'bio']);

export function trelloCallbackUrl(sourceId: string, tenantId: string, baseUrl?: string): string {
  const base = (baseUrl ?? process.env['TRELLO_CALLBACK_BASE_URL'] ?? process.env['NEXT_PUBLIC_APP_URL'] ?? process.env['BETTER_AUTH_URL'] ?? '').replace(/\/$/, '');
  if (!base) throw new Error('TRELLO_CALLBACK_BASE_URL or NEXT_PUBLIC_APP_URL is required');
  const url = new URL(`${base}/api/v1/webhooks/trello/${encodeURIComponent(sourceId)}`);
  url.searchParams.set('tenantId', tenantId);
  return url.toString();
}

export function computeTrelloWebhookSignature(rawBody: string, callbackUrl: string, secret: string): string {
  return createHmac('sha1', secret).update(rawBody + callbackUrl).digest('base64');
}

export function verifyTrelloWebhookSignature(input: {
  rawBody: string;
  callbackUrl: string;
  secret: string;
  signature: string | null | undefined;
}): boolean {
  if (!input.secret || !input.signature) return false;
  const expected = Buffer.from(computeTrelloWebhookSignature(input.rawBody, input.callbackUrl, input.secret));
  const actual = Buffer.from(input.signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Keep member ids for joins while avoiding duplicated Trello profile PII in event payloads. */
export function sanitizeTrelloPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeTrelloPayload);
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (PERSONAL_KEYS.has(key)) continue;
    output[key] = sanitizeTrelloPayload(nested);
  }
  return output;
}
