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
  has_code: boolean;
  has_code_verifier: boolean;
  has_client_assertion: boolean;
  client_assertion_type: string | null;
  has_cookie: boolean;
  has_origin: boolean;
};

export type TokenResponseLog = {
  status: number | null;
  oauth_error: string | null;
  error_description: string | null;
  token_type: string | null;
  expires_in: number | null;
  scope: string | null;
  has_access_token: boolean;
  has_refresh_token: boolean;
  has_id_token: boolean;
  access_token_alg: string | null;
  id_token_alg: string | null;
};

export type ClientAssertionLog = {
  alg: unknown;
  kid: unknown;
  iss: unknown;
  sub: unknown;
  aud: unknown;
  has_exp: boolean;
  has_iat: boolean;
  has_jti: boolean;
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
    has_code: fields.has('code'),
    has_code_verifier: fields.has('code_verifier'),
    has_client_assertion: fields.has('client_assertion'),
    client_assertion_type: fields.get('client_assertion_type'),
    has_cookie: headers.has('cookie'),
    has_origin: headers.has('origin'),
  };
}

export function describeTokenRequestBody(
  body: unknown,
  headers?: Headers,
): TokenRequestLog {
  const fields = bodyToSearchParams(body);
  return describeTokenRequest(fields, headers ?? new Headers());
}

export function describeTokenResponse(status: number | null, payload: unknown): TokenResponseLog {
  const record = asRecord(payload);
  return {
    status,
    oauth_error: typeof record?.error === 'string' ? record.error : null,
    error_description: typeof record?.error_description === 'string' ? record.error_description : null,
    token_type: typeof record?.token_type === 'string' ? record.token_type : null,
    expires_in: typeof record?.expires_in === 'number' ? record.expires_in : null,
    scope: typeof record?.scope === 'string' ? record.scope : null,
    has_access_token: typeof record?.access_token === 'string',
    has_refresh_token: typeof record?.refresh_token === 'string',
    has_id_token: typeof record?.id_token === 'string',
    access_token_alg: jwtAlg(typeof record?.access_token === 'string' ? record.access_token : null),
    id_token_alg: jwtAlg(typeof record?.id_token === 'string' ? record.id_token : null),
  };
}

export function describeTokenReturned(returned: unknown): TokenResponseLog {
  if (returned instanceof Response) {
    return describeTokenResponse(returned.status, null);
  }
  const record = asRecord(returned);
  if (record && typeof record.status === 'number' && ('body' in record || 'headers' in record)) {
    return describeTokenResponse(record.status, record.body ?? record);
  }
  return describeTokenResponse(null, returned);
}

export function describeClientAssertion(assertion: string | null | undefined): ClientAssertionLog | null {
  if (!assertion) return null;
  const [headerPart, payloadPart] = assertion.split('.');
  if (!headerPart || !payloadPart) return null;
  try {
    const header = asRecord(JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')));
    const payload = asRecord(JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')));
    if (!header || !payload) return null;
    return {
      alg: header.alg ?? null,
      kid: header.kid ?? null,
      iss: payload.iss ?? null,
      sub: payload.sub ?? null,
      aud: payload.aud ?? null,
      has_exp: typeof payload.exp === 'number',
      has_iat: typeof payload.iat === 'number',
      has_jti: typeof payload.jti === 'string' && payload.jti.length > 0,
    };
  } catch {
    return null;
  }
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

export function logTokenExchange(
  request: TokenRequestLog,
  response: TokenResponseLog,
  assertion?: ClientAssertionLog | null,
): void {
  logger.info({ ...request, ...response, ...(assertion ? { client_assertion: assertion } : {}) }, '[OAUTH TOKEN]');
}

export function logTokenRequest(log: TokenRequestLog): void {
  logger.info(log, '[OAUTH TOKEN REQUEST]');
}

export function logClientAssertion(log: ClientAssertionLog): void {
  logger.info(log, '[CLIENT ASSERTION]');
}

export function logTokenResponse(log: TokenResponseLog): void {
  logger.info(log, '[OAUTH TOKEN RESPONSE]');
}

export function logMcpAuth(log: McpAuthLog): void {
  logger.info(log, '[MCP AUTH]');
}

function bodyToSearchParams(body: unknown): URLSearchParams {
  if (body instanceof URLSearchParams) return body;
  if (typeof body === 'string') return new URLSearchParams(body);
  const record = asRecord(body);
  const params = new URLSearchParams();
  if (!record) return params;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') params.set(key, value);
  }
  return params;
}

function jwtAlg(token: string | null | undefined): string | null {
  if (!token) return null;
  const header = token.split('.')[0];
  if (!header) return null;
  try {
    const parsed = asRecord(JSON.parse(Buffer.from(header, 'base64url').toString('utf8')));
    return typeof parsed?.alg === 'string' ? parsed.alg : null;
  } catch {
    return null;
  }
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
