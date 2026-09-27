import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cookieValue,
  decodeTrelloOAuthState,
  encodeTrelloOAuthState,
  trelloOAuthStateMatches,
} from '../trello-oauth-state';

const originalKey = process.env['ENCRYPTION_KEY'];

beforeEach(() => {
  process.env['ENCRYPTION_KEY'] = '11'.repeat(32);
});

afterEach(() => {
  if (originalKey === undefined) delete process.env['ENCRYPTION_KEY'];
  else process.env['ENCRYPTION_KEY'] = originalKey;
});

describe('Trello OAuth state', () => {
  it('encrypts the PKCE verifier and validates state in constant-time helper', () => {
    const encoded = encodeTrelloOAuthState({
      state: 'state-1', codeVerifier: 'verifier-secret', tenantId: 'tenant-1',
      operatorId: 'operator-1', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(encoded).not.toContain('verifier-secret');
    expect(decodeTrelloOAuthState(encoded)).toMatchObject({ tenantId: 'tenant-1', state: 'state-1' });
    expect(trelloOAuthStateMatches('state-1', 'state-1')).toBe(true);
    expect(trelloOAuthStateMatches('state-1', 'state-2')).toBe(false);
  });

  it('reads an encoded cookie value', () => {
    const request = new Request('https://bko.test', { headers: { cookie: 'other=x; oauth=a%2Bb%3D' } });
    expect(cookieValue(request, 'oauth')).toBe('a+b=');
  });
});
