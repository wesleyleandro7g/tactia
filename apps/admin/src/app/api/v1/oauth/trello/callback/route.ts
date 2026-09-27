import { NextResponse } from 'next/server';
import {
  exchangeTrelloAuthorizationCode,
  trelloOAuthConfigFromEnv,
} from '@tactia/domain';
import { createApiHandler } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { backofficeService } from '@/lib/services';
import {
  cookieValue,
  decodeTrelloOAuthState,
  trelloOAuthStateMatches,
  TRELLO_OAUTH_STATE_COOKIE,
} from '@/lib/trello-oauth-state';

function clearStateCookie(response: NextResponse, secure: boolean) {
  response.cookies.set(TRELLO_OAUTH_STATE_COOKIE, '', {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api/v1/oauth/trello',
    maxAge: 0,
  });
  return response;
}

export const GET = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx) => {
    const config = trelloOAuthConfigFromEnv();
    const secure = new URL(config.redirectUri).protocol === 'https:';
    const encoded = cookieValue(request, TRELLO_OAUTH_STATE_COOKIE);
    let tenantId: string | null = null;

    try {
      if (!encoded) throw new Error('missing_state_cookie');
      const pending = decodeTrelloOAuthState(encoded);
      tenantId = pending.tenantId;
      if (pending.operatorId !== ctx.operatorId) throw new Error('operator_mismatch');
      await backofficeService.getTenant(ctx, pending.tenantId);

      const url = new URL(request.url);
      const returnedState = url.searchParams.get('state') ?? '';
      if (!trelloOAuthStateMatches(pending.state, returnedState)) throw new Error('state_mismatch');
      if (url.searchParams.has('error')) throw new Error('authorization_denied');
      const code = url.searchParams.get('code');
      if (!code) throw new Error('missing_code');

      const tokens = await exchangeTrelloAuthorizationCode({
        config,
        code,
        codeVerifier: pending.codeVerifier,
      });
      const now = Date.now();
      const credential = await backofficeService.createCredential(ctx, pending.tenantId, {
        provider: 'trello',
        data: {
          authType: 'oauth2',
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          tokenType: tokens.tokenType,
          scope: tokens.scope,
          expiresAt: new Date(now + tokens.expiresIn * 1000).toISOString(),
          refreshTokenExpiresAt: new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString(),
          authorizedAt: new Date(now).toISOString(),
        },
      });

      const destination = new URL(`/tenants/${pending.tenantId}/data-sources/new/trello`, request.url);
      destination.searchParams.set('oauth', 'success');
      destination.searchParams.set('credentialId', credential.id);
      return clearStateCookie(NextResponse.redirect(destination), secure);
    } catch (error) {
      const destination = tenantId
        ? new URL(`/tenants/${tenantId}/data-sources/new/trello`, request.url)
        : new URL('/', request.url);
      destination.searchParams.set('oauth', 'error');
      destination.searchParams.set(
        'reason',
        error instanceof Error && ['authorization_denied', 'state_mismatch', 'missing_code'].includes(error.message)
          ? error.message
          : 'oauth_failed',
      );
      return clearStateCookie(NextResponse.redirect(destination), secure);
    }
  },
);
