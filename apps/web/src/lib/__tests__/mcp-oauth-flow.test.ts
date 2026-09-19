import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@tactia/database';
import { createId } from '@tactia/shared';
import { auth } from '../auth';
import { MCP_AUTH_ISSUER, MCP_RESOURCE_URL } from '../mcp-auth';
import { resolveOAuthMcpContext } from '../mcp-oauth-context';
import { POST as revokeConnection } from '../../app/api/v1/oauth/connections/[id]/revoke/route';
import { getMcpCompany, selectMcpCompany } from '../mcp-oauth-selection';
import { POST as callMcp } from '../../app/mcp/route';
import { RATE_LIMITS } from '../rate-limit';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@better-auth/cimd/node', () => ({
  fetchClientMetadataResource: async (url: string) => url.endsWith('/oauth/jwks.json')
    ? Response.json({ keys: [{
      ...clientKeys.publicKey.export({ format: 'jwk' }), kid: authId, use: 'sig', alg: 'RS256',
    }] })
    : Response.json({
    client_id: url,
    client_name: 'ChatGPT test fixture',
    redirect_uris: ['https://example.com/mcp/callback'],
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
    jwks_uri: 'https://chatgpt.com/oauth/jwks.json',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  }),
}));

const authId = createId();
const userId = createId();
const tenantId = createId();
const clientId = `mcp-test-${createId()}`;
const cimdClientId = `https://chatgpt.com/oauth/test_${authId}/client.json`;
const email = `${authId}@mcp.test`;
const password = randomBytes(24).toString('hex');
const redirectUri = 'https://example.com/mcp/callback';
let cookie = '';
const authorizationIds: string[] = [];
const clientKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });

function clientAssertion() {
  const iat = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: authId, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: cimdClientId, sub: cimdClientId, aud: `${MCP_AUTH_ISSUER}/oauth2/token`,
    iat, exp: iat + 60, jti: createId(),
  })).toString('base64url');
  return `${header}.${payload}.${sign('SHA256', Buffer.from(`${header}.${payload}`), clientKeys.privateKey).toString('base64url')}`;
}

async function request(path: string, body?: Record<string, unknown>, form = false, withSession = true) {
  return auth.handler(new Request(`${MCP_AUTH_ISSUER}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      accept: 'application/json',
      origin: new URL(MCP_AUTH_ISSUER).origin,
      ...(cookie && withSession ? { cookie } : {}),
      ...(body ? { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' } : {}),
    },
    ...(body ? { body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body) } : {}),
  }));
}

beforeAll(async () => {
  const context = await auth.$context;
  await prisma.authUser.create({ data: { id: authId, name: 'MCP Test', email, emailVerified: true } });
  await prisma.authAccount.create({ data: {
    id: createId(), issuer: 'local:credential', accountId: authId, providerId: 'credential',
    userId: authId, password: await context.password.hash(password),
  } });
  await prisma.user.create({ data: { id: userId, externalAuthId: authId, name: 'MCP Test', email } });
  await prisma.tenant.create({ data: { id: tenantId, name: 'MCP Test', slug: `mcp-${tenantId}` } });
  await prisma.membership.create({ data: { id: createId(), userId, tenantId, role: 'owner' } });
  await prisma.oauthClient.create({ data: {
    id: clientId, clientId, name: 'MCP test client', scopes: ['tools:read', 'tools:propose', 'offline_access'],
    redirectUris: [redirectUri], contacts: [], postLogoutRedirectUris: [],
    grantTypes: ['authorization_code', 'refresh_token'], responseTypes: ['code'],
    tokenEndpointAuthMethod: 'none', requirePKCE: true,
  } });
  await prisma.oauthClientResource.create({ data: { id: createId(), clientId, resourceId: MCP_RESOURCE_URL } });
  const login = await request('/sign-in/email', { email, password });
  expect(login.status).toBe(200);
  cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
});

afterAll(async () => {
  vi.restoreAllMocks();
  await prisma.mcpRateLimitBucket.deleteMany({ where: { key: { in: authorizationIds.map((id) => `${RATE_LIMITS.mcp.name}:oauth:${id}`) } } });
  await prisma.oauthClient.deleteMany({ where: { clientId: { in: [clientId, cimdClientId] } } });
  await prisma.authVerification.deleteMany({ where: { identifier: { startsWith: 'mcp-company:' }, value: tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.authUser.deleteMany({ where: { id: authId } });
  await prisma.$disconnect();
});

async function authorize(oauthClientId = clientId) {
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      client_id: oauthClientId, redirect_uri: redirectUri, response_type: 'code', prompt: 'consent',
      scope: 'tools:read offline_access', resource: MCP_RESOURCE_URL, state: 'test-state',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    });
    const authorization = await request(`/oauth2/authorize?${query}`);
    const authorizationBody = await authorization.json();
    expect(authorization.status, JSON.stringify(authorizationBody)).toBe(200);
    const consentUrl = new URL(authorizationBody.url, MCP_AUTH_ISSUER);
    expect(consentUrl.pathname).toBe('/oauth/consent');
    const consent = await request('/oauth2/consent', {
      accept: true, scope: 'tools:read offline_access', oauth_query: consentUrl.search.slice(1),
    });
    const consentBody = await consent.json();
    expect(consent.status, JSON.stringify(consentBody)).toBe(200);
    const callback = new URL(consentBody.url);
    expect(callback.searchParams.get('state')).toBe('test-state');
    expect(callback.searchParams.get('iss')).toBe(MCP_AUTH_ISSUER);
    expect([...callback.searchParams.keys()]).toEqual(expect.arrayContaining(['code', 'state', 'iss']));
    const tokens = await request('/oauth2/token', {
      grant_type: 'authorization_code', client_id: oauthClientId, redirect_uri: redirectUri,
      code: callback.searchParams.get('code'), code_verifier: verifier, resource: MCP_RESOURCE_URL,
      ...(oauthClientId === cimdClientId ? {
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: clientAssertion(),
      } : {}),
    }, true);
    const tokenBody = await tokens.json();
    expect(tokens.status, tokenBody.error_description).toBe(200);
    expect(tokenBody.access_token).toBeTruthy();
    expect(tokenBody.refresh_token).toBeTruthy();
    const claims = JSON.parse(Buffer.from(tokenBody.access_token.split('.')[1], 'base64url').toString());
    expect(claims.iss).toBe(MCP_AUTH_ISSUER);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    expect(audiences).toContain(MCP_RESOURCE_URL);
    return { tokenBody, claims };
}

describe('MCP OAuth authorization flow', () => {
  it('advertises RFC 9207 iss support and CIMD-compatible token auth methods', async () => {
    const response = await request('/.well-known/oauth-authorization-server');
    const metadata = await response.json();
    expect(response.status).toBe(200);
    expect(metadata.issuer).toBe(MCP_AUTH_ISSUER);
    expect(metadata.authorization_response_iss_parameter_supported).toBe(true);
    expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(expect.arrayContaining(['none', 'private_key_jwt']));
  });

  it('authorizes with PKCE, rotates tokens, and keeps revoked JWTs invalid after reconnection', async () => {
    const { tokenBody, claims } = await authorize();
    const ctx = await resolveOAuthMcpContext(new Request(MCP_RESOURCE_URL), claims);
    authorizationIds.push(ctx.mcpAuthorizationId);
    expect(ctx.tenantId).toBe(tenantId);
    expect(ctx.apiKeyScopes).toContain('tools:read');
    const refresh = await request('/oauth2/token', {
      grant_type: 'refresh_token', client_id: clientId,
      refresh_token: tokenBody.refresh_token, resource: MCP_RESOURCE_URL,
    }, true);
    const refreshed = await refresh.json();
    expect(refresh.status, refreshed.error_description).toBe(200);
    expect(refreshed.refresh_token).not.toBe(tokenBody.refresh_token);
    const revoked = await revokeConnection(new Request(`${MCP_AUTH_ISSUER}/../oauth/connections/${ctx.mcpAuthorizationId}/revoke`, {
      method: 'POST', headers: { cookie },
    }), { params: Promise.resolve({ id: ctx.mcpAuthorizationId }) });
    expect(revoked.status).toBe(201);
    await expect(resolveOAuthMcpContext(new Request(MCP_RESOURCE_URL), claims)).rejects.toThrow('revogada');
    const renewed = await authorize();
    await expect(resolveOAuthMcpContext(new Request(MCP_RESOURCE_URL), renewed.claims)).resolves.toMatchObject({ tenantId });
    await expect(resolveOAuthMcpContext(new Request(MCP_RESOURCE_URL), claims)).rejects.toThrow('revogada');
    const revokedRefresh = await request('/oauth2/token', {
      grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshed.refresh_token, resource: MCP_RESOURCE_URL,
    }, true);
    expect(revokedRefresh.status).toBe(400);
  });

  it('registers an allowed CIMD client and issues company-bound tokens', async () => {
    const { claims } = await authorize(cimdClientId);
    await expect(resolveOAuthMcpContext(new Request(MCP_RESOURCE_URL), claims)).resolves.toMatchObject({ tenantId, mcpClientId: cimdClientId });
    await prisma.membership.updateMany({ where: { userId, tenantId }, data: { status: 'suspended' } });
    await expect(resolveOAuthMcpContext(new Request(MCP_RESOURCE_URL), claims)).rejects.toThrow('revogado');
    await prisma.membership.updateMany({ where: { userId, tenantId }, data: { status: 'active' } });
  });

  it('isolates simultaneous company selections and prevents replacing an existing choice', async () => {
    const first = new URLSearchParams({ client_id: clientId, code_challenge: createId() });
    const second = new URLSearchParams({ client_id: clientId, code_challenge: createId() });
    await selectMcpCompany(authId, first, tenantId);
    await expect(getMcpCompany(authId, second)).resolves.toBeNull();
    await expect(selectMcpCompany(authId, first, createId())).rejects.toThrow('mudou');
    await expect(getMcpCompany(authId, first)).resolves.toBe(tenantId);
  });

  it('resumes authorization after login using the signed OAuth query', async () => {
    const query = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: 'code', prompt: 'consent',
      scope: 'tools:read', resource: MCP_RESOURCE_URL,
      code_challenge: randomBytes(32).toString('base64url'), code_challenge_method: 'S256',
    });
    const authorization = await request(`/oauth2/authorize?${query}`, undefined, false, false);
    const body = await authorization.json();
    const loginUrl = new URL(body.url, MCP_AUTH_ISSUER);
    expect(loginUrl.pathname).toBe('/login');
    const login = await request('/sign-in/email', { email, password, oauth_query: loginUrl.search.slice(1) }, false, false);
    const continuation = await login.json();
    expect(login.status).toBe(200);
    expect(continuation.redirect).toBe(true);
    expect(new URL(continuation.url, MCP_AUTH_ISSUER).pathname).toBe('/oauth/consent');
  });

  it('verifies signed bearer tokens on /mcp, enforces scopes and returns 429 for quota exhaustion', async () => {
    const { tokenBody, claims } = await authorize();
    const ctx = await resolveOAuthMcpContext(new Request(MCP_RESOURCE_URL), claims);
    authorizationIds.push(ctx.mcpAuthorizationId);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === `${MCP_AUTH_ISSUER}/jwks`) return auth.handler(new Request(url));
      throw new Error('Unexpected external request');
    });
    const mcpRequest = (token?: string, method = 'tools/list', params = {}) => new Request(MCP_RESOURCE_URL, {
      method: 'POST', headers: {
        'content-type': 'application/json', accept: 'application/json, text/event-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    try {
      const anonymous = await callMcp(mcpRequest());
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers.get('WWW-Authenticate')).toContain('resource_metadata');
      expect((await callMcp(mcpRequest(`${tokenBody.access_token}invalid`))).status).toBe(401);
      const listed = await callMcp(mcpRequest(tokenBody.access_token));
      expect(listed.status).toBe(200);
      const tools = (await listed.json()).result.tools.map((tool: { name: string }) => tool.name);
      expect(tools).toContain('get_profile');
      expect(tools).toContain('get_revenue');
      expect(tools).not.toContain('propose_action');
      const profile = await callMcp(mcpRequest(tokenBody.access_token, 'tools/call', { name: 'get_profile', arguments: {} }));
      expect((await profile.json()).result.structuredContent.nickname).toContain('MCP Test');
      await prisma.mcpRateLimitBucket.update({
        where: { key: `${RATE_LIMITS.mcp.name}:oauth:${ctx.mcpAuthorizationId}` }, data: { count: 1000 },
      });
      const limited = await callMcp(mcpRequest(tokenBody.access_token));
      expect(limited.status).toBe(429);
      expect(limited.headers.get('Retry-After')).toBeTruthy();
      expect(limited.headers.has('WWW-Authenticate')).toBe(false);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
