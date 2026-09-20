import { describe, expect, it } from 'vitest';
import { MCP_AUTH_ISSUER, MCP_RESOURCE_URL } from '../mcp-auth';
import {
  describeAuthorizeCallback,
  describeClientAssertion,
  describeMcpAuth,
  describeTokenRequest,
  describeTokenResponse,
} from '../mcp-oauth-debug';

function signedPart(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('MCP OAuth diagnostic logs', () => {
  it('records RFC 9207 callback param names without leaking the authorization code', () => {
    const code = 'SECRET_AUTHORIZATION_CODE';
    const log = describeAuthorizeCallback(
      `https://chatgpt.com/connector_platform_oauth_redirect?code=${code}&state=st&iss=${encodeURIComponent(MCP_AUTH_ISSUER)}`,
      new URLSearchParams({
        client_id: 'https://chatgpt.com/oauth/client.json',
        redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
        resource: MCP_RESOURCE_URL,
        scope: 'tools:read',
        state: 'st',
      }),
    );
    expect(log.iss_added_to_redirect).toBe(true);
    expect(log.iss_matches_issuer).toBe(true);
    expect(log.callback_query_params).toEqual(['code', 'state', 'iss']);
    expect(JSON.stringify(log)).not.toContain(code);
  });

  it('flags private_key_jwt token requests without logging the assertion or verifier', () => {
    const assertion = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature';
    const log = describeTokenRequest(new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'https://chatgpt.com/oauth/client.json',
      redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      resource: MCP_RESOURCE_URL,
      code: 'SECRET_CODE',
      code_verifier: 'SECRET_VERIFIER',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    }), new Headers({ origin: 'https://chatgpt.com' }));
    expect(log.has_code).toBe(true);
    expect(log.has_code_verifier).toBe(true);
    expect(log.has_client_assertion).toBe(true);
    expect(log.client_assertion_type).toBe('urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    const serialized = JSON.stringify(log);
    expect(serialized).not.toContain('SECRET_CODE');
    expect(serialized).not.toContain('SECRET_VERIFIER');
    expect(serialized).not.toContain(assertion);
  });

  it('keeps token success and OAuth errors free of issued tokens', () => {
    expect(describeTokenResponse(200, { access_token: 'SECRET_TOKEN', token_type: 'Bearer' })).toEqual({
      status: 200,
      oauth_error: null,
      error_description: null,
      token_type: 'Bearer',
      expires_in: null,
      scope: null,
      has_access_token: true,
      has_refresh_token: false,
      has_id_token: false,
      access_token_alg: null,
      id_token_alg: null,
    });
    expect(describeTokenResponse(400, { error: 'invalid_client', error_description: 'jwks' })).toEqual({
      status: 400,
      oauth_error: 'invalid_client',
      error_description: 'jwks',
      token_type: null,
      expires_in: null,
      scope: null,
      has_access_token: false,
      has_refresh_token: false,
      has_id_token: false,
      access_token_alg: null,
      id_token_alg: null,
    });
  });

  it('decodes client assertion header and payload without logging jti or the JWT', () => {
    const jti = 'SECRET_JTI_VALUE';
    const assertion = [
      signedPart({ alg: 'RS256', kid: 'openai-kid-1', typ: 'JWT' }),
      signedPart({
        iss: 'https://chatgpt.com/oauth/client.json',
        sub: 'https://chatgpt.com/oauth/client.json',
        aud: `${MCP_AUTH_ISSUER}/oauth2/token`,
        exp: 1_700_000_000,
        iat: 1_699_999_700,
        jti,
      }),
      'signature',
    ].join('.');
    const log = describeClientAssertion(assertion);
    expect(log).toEqual({
      alg: 'RS256',
      kid: 'openai-kid-1',
      iss: 'https://chatgpt.com/oauth/client.json',
      sub: 'https://chatgpt.com/oauth/client.json',
      aud: `${MCP_AUTH_ISSUER}/oauth2/token`,
      has_exp: true,
      has_iat: true,
      has_jti: true,
    });
    const serialized = JSON.stringify(log);
    expect(serialized).not.toContain(assertion);
    expect(serialized).not.toContain(jti);
  });

  it('extracts MCP bearer claims without logging the JWT', () => {
    const payload = Buffer.from(JSON.stringify({
      iss: MCP_AUTH_ISSUER,
      aud: MCP_RESOURCE_URL,
      scope: 'tools:read',
      sub: 'user_1',
    })).toString('base64url');
    const token = `header.${payload}.signature`;
    const log = describeMcpAuth(401, `Bearer ${token}`, 'Bearer error="invalid_token"');
    expect(log).toMatchObject({
      status: 401,
      iss: MCP_AUTH_ISSUER,
      aud: MCP_RESOURCE_URL,
      scope: 'tools:read',
      sub: 'user_1',
      oauth_error: 'invalid_token',
    });
    expect(JSON.stringify(log)).not.toContain(token);
  });
});
