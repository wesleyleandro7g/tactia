import { createHash, randomBytes } from 'node:crypto';

export const TRELLO_OAUTH_SCOPES = [
  'read:board:trello',
  'read:member:trello',
  'offline_access',
] as const;

export type TrelloOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationUrl?: string;
  tokenUrl?: string;
};

export type TrelloOAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
  tokenType: string;
};

export class TrelloOAuthError extends Error {
  constructor(message: string, readonly code = 'oauth_error', readonly status = 400) {
    super(message);
    this.name = 'TrelloOAuthError';
  }
}

export function generateTrelloPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function generateTrelloOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

export function buildTrelloAuthorizationUrl(input: {
  config: TrelloOAuthConfig;
  state: string;
  challenge: string;
  scopes?: readonly string[];
}): string {
  const url = new URL(input.config.authorizationUrl ?? 'https://auth.atlassian.com/authorize');
  url.searchParams.set('client_id', input.config.clientId);
  url.searchParams.set('scope', (input.scopes ?? TRELLO_OAUTH_SCOPES).join(' '));
  url.searchParams.set('redirect_uri', input.config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', input.challenge);
  return url.toString();
}

function tokensFrom(value: unknown): TrelloOAuthTokens {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TrelloOAuthError('Invalid token response from Atlassian');
  }
  const body = value as Record<string, unknown>;
  if (typeof body['error'] === 'string') {
    throw new TrelloOAuthError(
      typeof body['error_description'] === 'string' ? body['error_description'] : body['error'],
      body['error'],
    );
  }
  if (typeof body['access_token'] !== 'string' || typeof body['refresh_token'] !== 'string') {
    throw new TrelloOAuthError('Atlassian did not return access and refresh tokens');
  }
  return {
    accessToken: body['access_token'],
    refreshToken: body['refresh_token'],
    expiresIn: typeof body['expires_in'] === 'number' ? body['expires_in'] : 3600,
    scope: typeof body['scope'] === 'string' ? body['scope'] : '',
    tokenType: typeof body['token_type'] === 'string' ? body['token_type'] : 'Bearer',
  };
}

async function requestTokens(
  config: TrelloOAuthConfig,
  payload: Record<string, string>,
  fetcher: typeof globalThis.fetch,
): Promise<TrelloOAuthTokens> {
  const response = await fetcher(config.tokenUrl ?? 'https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...payload,
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    throw new TrelloOAuthError(
      typeof record['error_description'] === 'string' ? record['error_description'] : `Atlassian token endpoint returned ${response.status}`,
      typeof record['error'] === 'string' ? record['error'] : 'token_exchange_failed',
      response.status,
    );
  }
  return tokensFrom(body);
}

export function exchangeTrelloAuthorizationCode(input: {
  config: TrelloOAuthConfig;
  code: string;
  codeVerifier: string;
  fetch?: typeof globalThis.fetch;
}): Promise<TrelloOAuthTokens> {
  return requestTokens(input.config, {
    grant_type: 'authorization_code',
    redirect_uri: input.config.redirectUri,
    code: input.code,
    code_verifier: input.codeVerifier,
  }, input.fetch ?? globalThis.fetch);
}

export function refreshTrelloOAuthTokens(input: {
  config: TrelloOAuthConfig;
  refreshToken: string;
  fetch?: typeof globalThis.fetch;
}): Promise<TrelloOAuthTokens> {
  return requestTokens(input.config, {
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  }, input.fetch ?? globalThis.fetch);
}
