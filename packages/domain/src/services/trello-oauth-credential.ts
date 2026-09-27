import type { CredentialRepository } from '@tactia/database';
import {
  refreshTrelloOAuthTokens,
  type TrelloAuth,
  type TrelloOAuthConfig,
} from '@tactia/connectors';
import { AppError, ErrorCode } from '@tactia/shared';
import { decrypt, encrypt } from './credential-service';

const ACCESS_TOKEN_SKEW_MS = 5 * 60 * 1000;

export function trelloOAuthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TrelloOAuthConfig {
  const clientId = env['TRELLO_OAUTH_CLIENT_ID']?.trim();
  const clientSecret = env['TRELLO_OAUTH_CLIENT_SECRET']?.trim();
  const redirectUri = env['TRELLO_OAUTH_REDIRECT_URI']?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      'TRELLO_OAUTH_CLIENT_ID, TRELLO_OAUTH_CLIENT_SECRET and TRELLO_OAUTH_REDIRECT_URI are required',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

function recordFromEncrypted(encryptedData: string): Record<string, unknown> {
  return JSON.parse(decrypt(encryptedData)) as Record<string, unknown>;
}

function validAccessToken(data: Record<string, unknown>, now = Date.now()): string | null {
  const accessToken = data['accessToken'];
  const expiresAt = data['expiresAt'];
  if (typeof accessToken !== 'string' || typeof expiresAt !== 'string') return null;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry > now + ACCESS_TOKEN_SKEW_MS ? accessToken : null;
}

export async function trelloAuthFromCredential(input: {
  tenantId: string;
  credentialId: string;
  credentials: CredentialRepository;
}): Promise<TrelloAuth> {
  const initial = await input.credentials.findById({ tenantId: input.tenantId, id: input.credentialId });
  if (!initial) throw new AppError(ErrorCode.NOT_FOUND, 'Credential not found');
  const initialData = recordFromEncrypted(initial.encryptedData);

  if (initialData['authType'] !== 'oauth2') {
    return {
      kind: 'token',
      apiKey: String(initialData['apiKey'] ?? ''),
      token: String(initialData['token'] ?? ''),
    };
  }

  const rotate = async (force: boolean): Promise<string> => {
    const current = await input.credentials.findById({ tenantId: input.tenantId, id: input.credentialId });
    if (!current) throw new AppError(ErrorCode.NOT_FOUND, 'Credential not found');
    const data = recordFromEncrypted(current.encryptedData);
    const stillValid = validAccessToken(data);
    if (!force && stillValid) return stillValid;
    const refreshToken = data['refreshToken'];
    if (typeof refreshToken !== 'string' || !refreshToken) {
      throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Trello refresh token is missing');
    }

    let tokens;
    try {
      tokens = await refreshTrelloOAuthTokens({
        config: trelloOAuthConfigFromEnv(),
        refreshToken,
      });
    } catch (error) {
      // Another worker may have consumed the single-use refresh token first.
      const latest = await input.credentials.findById({ tenantId: input.tenantId, id: input.credentialId });
      if (latest && latest.encryptedData !== current.encryptedData) {
        const winnerToken = validAccessToken(recordFromEncrypted(latest.encryptedData));
        if (winnerToken) return winnerToken;
      }
      throw error;
    }

    const nextData = {
      ...data,
      authType: 'oauth2',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: tokens.tokenType,
      scope: tokens.scope,
      expiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
      refreshedAt: new Date().toISOString(),
    };
    const encryptedData = encrypt(JSON.stringify(nextData));
    const updated = await input.credentials.updateEncryptedDataIfCurrent({
      tenantId: input.tenantId,
      id: input.credentialId,
      currentEncryptedData: current.encryptedData,
      encryptedData,
    });
    if (updated.count === 1) return tokens.accessToken;

    const winner = await input.credentials.findById({ tenantId: input.tenantId, id: input.credentialId });
    const winnerToken = winner ? validAccessToken(recordFromEncrypted(winner.encryptedData)) : null;
    if (!winnerToken) throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Trello token refresh race failed');
    return winnerToken;
  };

  const accessToken = validAccessToken(initialData) ?? await rotate(false);
  return {
    kind: 'oauth2',
    accessToken,
    refreshAccessToken: () => rotate(true),
  };
}
