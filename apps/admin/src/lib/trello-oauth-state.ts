import { timingSafeEqual } from 'node:crypto';
import { decrypt, encrypt } from '@tactia/domain';

export const TRELLO_OAUTH_STATE_COOKIE = 'tactia_trello_oauth_state';
export const TRELLO_OAUTH_STATE_TTL_SECONDS = 10 * 60;

export type TrelloOAuthStatePayload = {
  state: string;
  codeVerifier: string;
  tenantId: string;
  operatorId: string;
  expiresAt: string;
};

export function encodeTrelloOAuthState(payload: TrelloOAuthStatePayload): string {
  return encrypt(JSON.stringify(payload));
}

export function decodeTrelloOAuthState(encoded: string): TrelloOAuthStatePayload {
  const parsed = JSON.parse(decrypt(encoded)) as Partial<TrelloOAuthStatePayload>;
  if (
    typeof parsed.state !== 'string' ||
    typeof parsed.codeVerifier !== 'string' ||
    typeof parsed.tenantId !== 'string' ||
    typeof parsed.operatorId !== 'string' ||
    typeof parsed.expiresAt !== 'string'
  ) throw new Error('Invalid Trello OAuth state');
  if (Date.parse(parsed.expiresAt) <= Date.now()) throw new Error('Expired Trello OAuth state');
  return parsed as TrelloOAuthStatePayload;
}

export function trelloOAuthStateMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}
