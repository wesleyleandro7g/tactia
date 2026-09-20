import {
  AppError,
  ErrorCode,
  fail,
  logger,
  REQUEST_ID_HEADER,
  createId,
} from '@tactia/shared';
import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';
import { getClientIp } from '@/lib/api';
import {
  describeAuthorizeCallback,
  describeClientAssertion,
  describeTokenRequest,
  describeTokenResponse,
  logAuthorizeCallback,
  logTokenExchange,
  parseOAuthQuery,
  readFormParams,
} from '@/lib/mcp-oauth-debug';
import { consumeRateLimit } from '@/lib/rate-limit';

const handler = toNextJsHandler(auth);

function authPath(request: Request): string {
  return new URL(request.url).pathname;
}

function skipCredentialRateLimit(request: Request): boolean {
  const path = authPath(request);
  if (path.endsWith('/jwks') || path.includes('/.well-known/')) return true;
  return (
    path.endsWith('/oauth2/token') ||
    path.endsWith('/oauth2/userinfo') ||
    path.endsWith('/oauth2/introspect') ||
    path.endsWith('/oauth2/revoke')
  );
}

/** Brute-force guard on the credential endpoints (spec §49): 30 req/min por IP. */
function rateLimited(request: Request): Response | null {
  if (skipCredentialRateLimit(request)) return null;
  const ip = getClientIp(request) ?? 'unknown';
  const allowed = consumeRateLimit(`auth:${ip}`, 30, 60_000);
  if (allowed) return null;

  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? createId();
  const error = new AppError(
    ErrorCode.RATE_LIMITED,
    'Muitas tentativas. Aguarde um instante e tente novamente.',
  );
  logger.warn({
    request_id: requestId,
    tenant_id: null,
    user_id: null,
    operation: `${request.method} ${new URL(request.url).pathname}`,
    duration_ms: 0,
    status: error.statusCode,
    error: error.code,
    ip,
  });
  return Response.json(fail(error.code, error.message, requestId), {
    status: error.statusCode,
    headers: { [REQUEST_ID_HEADER]: requestId },
  });
}

export async function GET(request: Request) {
  const blocked = rateLimited(request);
  if (blocked) return blocked;
  const response = await handler.GET(request);
  if (authPath(request).endsWith('/oauth2/userinfo')) {
    const payload = await response.clone().json().catch(() => null);
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
    logger.info({
      status: response.status,
      has_authorization: request.headers.has('authorization'),
      oauth_error: typeof record?.error === 'string' ? record.error : null,
      error_description: typeof record?.error_description === 'string' ? record.error_description : null,
      has_sub: typeof record?.sub === 'string',
    }, '[OAUTH USERINFO]');
  }
  return response;
}

export async function POST(request: Request) {
  const blocked = rateLimited(request);
  if (blocked) return blocked;
  const path = authPath(request);
  if (path.endsWith('/oauth2/token')) {
    const fields = await readFormParams(request.clone());
    const response = await handler.POST(request);
    const payload = await response.clone().json().catch(() => null);
    logTokenExchange(
      describeTokenRequest(fields, request.headers),
      describeTokenResponse(response.status, payload),
      describeClientAssertion(fields.get('client_assertion')),
    );
    return response;
  }
  if (path.endsWith('/oauth2/consent')) {
    const fields = await readFormParams(request.clone());
    const response = await handler.POST(request);
    const payload = await response.clone().json().catch(() => null);
    const url = payload && typeof payload === 'object' && 'url' in payload && typeof payload.url === 'string'
      ? payload.url
      : null;
    if (url) logAuthorizeCallback(describeAuthorizeCallback(url, parseOAuthQuery(fields.get('oauth_query'))));
    return response;
  }
  if (path.endsWith('/oauth2/userinfo')) {
    const response = await handler.POST(request);
    const payload = await response.clone().json().catch(() => null);
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
    logger.info({
      status: response.status,
      has_authorization: request.headers.has('authorization'),
      oauth_error: typeof record?.error === 'string' ? record.error : null,
      error_description: typeof record?.error_description === 'string' ? record.error_description : null,
      has_sub: typeof record?.sub === 'string',
    }, '[OAUTH USERINFO]');
    return response;
  }
  return handler.POST(request);
}
