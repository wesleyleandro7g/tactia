import { describe, expect, it, vi } from 'vitest';
import {
  buildTrelloAuthorizationUrl,
  exchangeTrelloAuthorizationCode,
  generateTrelloPkce,
  refreshTrelloOAuthTokens,
  type TrelloOAuthConfig,
} from '../trello-oauth';

const config: TrelloOAuthConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://bko.example.com/api/v1/oauth/trello/callback',
};

describe('Trello OAuth 2.0', () => {
  it('builds an authorization-code URL with state, PKCE and offline access', () => {
    const pkce = generateTrelloPkce();
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.challenge).not.toBe(pkce.verifier);

    const url = new URL(buildTrelloAuthorizationUrl({ config, state: 'state-1', challenge: pkce.challenge }));
    expect(url.origin + url.pathname).toBe('https://auth.atlassian.com/authorize');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('offline_access');
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
  });

  it('exchanges a code without exposing the secret in the URL', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({
      access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600,
      token_type: 'Bearer', scope: 'read:board:trello read:member:trello offline_access',
    }));
    const tokens = await exchangeTrelloAuthorizationCode({ config, code: 'code-1', codeVerifier: 'verifier-1', fetch: fetcher as typeof fetch });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).not.toContain(config.clientSecret);
    expect(JSON.parse(String(init?.body))).toMatchObject({ client_secret: config.clientSecret, code_verifier: 'verifier-1' });
    expect(tokens.refreshToken).toBe('refresh-1');
  });

  it('rotates refresh tokens', async () => {
    const fetcher = vi.fn(async () => Response.json({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }));
    const tokens = await refreshTrelloOAuthTokens({ config, refreshToken: 'refresh-1', fetch: fetcher as typeof fetch });
    expect(tokens).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
  });
});
