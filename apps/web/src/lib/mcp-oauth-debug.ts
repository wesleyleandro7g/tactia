import { logger } from '@tactia/shared';
import { MCP_AUTH_ISSUER } from './mcp-auth';

export type AuthorizeCallbackLog = {
  client_id: string | null;
  redirect_uri: string | null;
  resource: string | null;
  scope: string | null;
  has_state: boolean;
  iss_added_to_redirect: boolean;
  iss_matches_issuer: boolean;
  callback_query_params: string[];
  callback_error: string | null;
};

export type TokenRequestLog = {
  grant_type: string | null;
  client_id: string | null;
  redirect_uri: string | null;
  resource: string | null;
  has_code_verifier: boolean;
  has_client_assertion: boolean;
  client_assertion_type: string | null;
  has_cookie: boolean;
  has_origin: boolean;
};

export type TokenResponseLog = {
  status: number;
  oauth_error: string | null;
};

export type McpAuthLog = {
  status: number;
  iss: unknown;
  aud: unknown;
  scope: unknown;
  sub: unknown;
  oauth_error: string | null;
};

export function describeAuthorizeCallback(
  callbackUrl: string,
  authorizeQuery?: URLSearchParams,
): AuthorizeCallbackLog {
  const callback = new URL(callbackUrl);
  const iss = callback.searchParams.get('iss');
  return {
    client_id: authorizeQuery?.get('client_id') ?? null,
    redirect_uri: authorizeQuery?.get('redirect_uri') ?? callback.origin + callback.pathname,
    resource: authorizeQuery?.get('resource') ?? null,
    scope: authorizeQuery?.get('scope') ?? null,
    has_state: callback.searchParams.has('state') || Boolean(authorizeQuery?.get('state')),
    iss_added_to_redirect: Boolean(iss),
    iss_matches_issuer: iss === MCP_AUTH_ISSUER,
    callback_query_params: [...callback.searchParams.keys()],
    callback_error: callback.searchParams.get('error'),
  };
}

export function describeTokenRequest(
  fields: URLSearchParams,
  headers: Headers,
): TokenRequestLog {
  return {
    grant_type: fields.get('grant_type'),
    client_id: fields.get('client_id'),
    redirect_uri: fields.get('redirect_uri'),
    resource: fields.get('resource'),
    has_code_verifier: fields.has('code_verifier'),
    has_client_assertion: fields.has('client_assertion'),
    client_assertion_type: fields.get('client_assertion_type'),
    has_cookie: headers.has('cookie'),
    has_origin: headers.has('origin'),
  };
}

export function describeTokenResponse(status: number, payload: unknown): TokenResponseLog {
  const record = asRecord(payload);
  return {
    status,
    oauth_error: typeof record?.error === 'string' ? record.error : null,
  };
}

export function describeMcpAuth(
  status: number,
  authorization: string | null,
  wwwAuthenticate: string | null,
): McpAuthLog {
  const claims = publicAccessTokenClaims(authorization);
  return {
    status,
    iss: claims?.iss ?? null,
    aud: claims?.aud ?? null,
    scope: claims?.scope ?? null,
    sub: claims?.sub ?? null,
    oauth_error: wwwAuthenticateError(wwwAuthenticate),
  };
}

export function parseOAuthQuery(value: unknown): URLSearchParams | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return new URLSearchParams(value.startsWith('?') ? value.slice(1) : value);
}

export async function readFormParams(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return new URLSearchParams(await request.text());
  }
  if (contentType.includes('application/json')) {
    const payload = asRecord(await request.json().catch(() => null));
    const params = new URLSearchParams();
    if (!payload) return params;
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'string') params.set(key, value);
    }
    return params;
  }
  return new URLSearchParams();
}

export function logAuthorizeCallback(log: AuthorizeCallbackLog): void {
  logger.info(log, '[OAUTH AUTHORIZE SUCCESS]');
}

export function logTokenExchange(request: TokenRequestLog, response: TokenResponseLog): void {
  logger.info({ ...request, ...response }, '[OAUTH TOKEN]');
}

export function logMcpAuth(log: McpAuthLog): void {
  logger.info(log, '[MCP AUTH]');
}

function publicAccessTokenClaims(authorization: string | null): Record<string, unknown> | null {
  const token = authorization?.match(/^Bearer\s+(\S+)/i)?.[1];
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = asRecord(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    if (!claims) return null;
    return {
      iss: claims.iss ?? null,
      aud: claims.aud ?? null,
      scope: claims.scope ?? null,
      sub: claims.sub ?? null,
    };
  } catch {
    return null;
  }
}

function wwwAuthenticateError(header: string | null): string | null {
  return header?.match(/\berror="([^"]+)"/)?.[1] ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
