import { NextResponse } from 'next/server';
import {
  buildTrelloAuthorizationUrl,
  generateTrelloOAuthState,
  generateTrelloPkce,
  trelloOAuthConfigFromEnv,
} from '@tactia/domain';
import { createApiHandler } from '@/lib/api';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { backofficeService } from '@/lib/services';
import {
  encodeTrelloOAuthState,
  TRELLO_OAUTH_STATE_COOKIE,
  TRELLO_OAUTH_STATE_TTL_SECONDS,
} from '@/lib/trello-oauth-state';

export const GET = createApiHandler(
  { auth: 'operator', rateLimit: RATE_LIMITS.mutate },
  async (request, ctx) => {
    const tenantId = new URL(request.url).searchParams.get('tenantId');
    if (!tenantId) return Response.json({ error: 'tenantId is required' }, { status: 400 });
    await backofficeService.getTenant(ctx, tenantId);

    const config = trelloOAuthConfigFromEnv();
    const state = generateTrelloOAuthState();
    const { verifier, challenge } = generateTrelloPkce();
    const authorizationUrl = buildTrelloAuthorizationUrl({ config, state, challenge });
    const encoded = encodeTrelloOAuthState({
      state,
      codeVerifier: verifier,
      tenantId,
      operatorId: ctx.operatorId!,
      expiresAt: new Date(Date.now() + TRELLO_OAUTH_STATE_TTL_SECONDS * 1000).toISOString(),
    });

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(TRELLO_OAUTH_STATE_COOKIE, encoded, {
      httpOnly: true,
      secure: new URL(config.redirectUri).protocol === 'https:',
      sameSite: 'lax',
      path: '/api/v1/oauth/trello',
      maxAge: TRELLO_OAUTH_STATE_TTL_SECONDS,
    });
    return response;
  },
);
