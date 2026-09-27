import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CredentialRepository } from '@tactia/database';
import { decrypt, encrypt } from '../services/credential-service';
import { trelloAuthFromCredential } from '../services/trello-oauth-credential';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env['ENCRYPTION_KEY'] = '22'.repeat(32);
  process.env['TRELLO_OAUTH_CLIENT_ID'] = 'client';
  process.env['TRELLO_OAUTH_CLIENT_SECRET'] = 'secret';
  process.env['TRELLO_OAUTH_REDIRECT_URI'] = 'https://bko.test/api/v1/oauth/trello/callback';
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe('Trello OAuth credential', () => {
  it('rotates and atomically stores an expired access/refresh token', async () => {
    let encryptedData = encrypt(JSON.stringify({
      authType: 'oauth2', accessToken: 'old-access', refreshToken: 'old-refresh',
      expiresAt: '2020-01-01T00:00:00.000Z',
    }));
    const repository = {
      findById: vi.fn(async () => ({ id: 'credential', tenantId: 'tenant', provider: 'trello', encryptedData })),
      updateEncryptedDataIfCurrent: vi.fn(async (input: { currentEncryptedData: string; encryptedData: string }) => {
        if (input.currentEncryptedData !== encryptedData) return { count: 0 };
        encryptedData = input.encryptedData;
        return { count: 1 };
      }),
    } as unknown as CredentialRepository;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600,
      token_type: 'Bearer', scope: 'read:board:trello read:member:trello offline_access',
    })));

    const auth = await trelloAuthFromCredential({ tenantId: 'tenant', credentialId: 'credential', credentials: repository });
    expect(auth).toMatchObject({ kind: 'oauth2', accessToken: 'new-access' });
    expect(JSON.parse(decrypt(encryptedData))).toMatchObject({ refreshToken: 'new-refresh', accessToken: 'new-access' });
  });
});
