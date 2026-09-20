import { createHash } from 'node:crypto';
import { createLocalJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify, type JSONWebKeySet, type JWK } from 'jose';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { MCP_AUTH_ISSUER } from './mcp-auth';

const CHATGPT_CLIENT_ID = 'https://chatgpt.com/oauth/client.json';
const CHATGPT_JWKS_URI = 'https://chatgpt.com/oauth/jwks.json';
const TOKEN_AUDIENCE = `${MCP_AUTH_ISSUER}/oauth2/token`;

type CimdFetch = typeof fetchClientMetadataResource;

/** Temporary: log every CIMD transport fetch (metadata + JWKS). */
export const debugCimdFetch: CimdFetch = async (input, init) => {
  const url = input instanceof URL ? input.toString() : String(input);
  const startedAt = Date.now();
  try {
    const response = await fetchClientMetadataResource(input, init);
    console.info('[CIMD FETCH]', {
      url,
      status: response.status,
      contentType: response.headers.get('content-type'),
      elapsedMs: Date.now() - startedAt,
    });
    return response;
  } catch (error) {
    console.error('[CIMD FETCH ERROR]', {
      url,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

function jwkFingerprint(key: JWK | undefined): string | null {
  if (!key || typeof key !== 'object') return null;
  const material = {
    kty: 'kty' in key ? key.kty : undefined,
    kid: 'kid' in key ? key.kid : undefined,
    n: 'n' in key ? key.n : undefined,
    e: 'e' in key ? key.e : undefined,
  };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0, 16);
}

function claimTiming(payload: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const nbf = typeof payload.nbf === 'number' ? payload.nbf : null;
  const iat = typeof payload.iat === 'number' ? payload.iat : null;
  const exp = typeof payload.exp === 'number' ? payload.exp : null;
  return {
    now,
    nbf,
    iat,
    exp,
    nbf_minus_now_s: nbf === null ? null : nbf - now,
    now_minus_iat_s: iat === null ? null : now - iat,
    exp_minus_now_s: exp === null ? null : exp - now,
  };
}

/**
 * Temporary: verify ChatGPT client_assertion with jose against the live OpenAI JWKS,
 * using the same CIMD transport Better Auth uses. Does not log the assertion.
 */
export async function debugVerifyChatGPTAssertion(assertion: string): Promise<void> {
  const jwksResponse = await debugCimdFetch(new URL(CHATGPT_JWKS_URI));
  if (!jwksResponse.ok) {
    console.error('[OPENAI JWKS VERIFY]', {
      jwksStatus: jwksResponse.status,
      success: false,
    });
    return;
  }

  const jwks = (await jwksResponse.json()) as JSONWebKeySet;
  let header: ReturnType<typeof decodeProtectedHeader>;
  let unverified: Record<string, unknown>;
  try {
    header = decodeProtectedHeader(assertion);
    unverified = decodeJwt(assertion) as Record<string, unknown>;
  } catch (error) {
    console.error('[OPENAI JWKS VERIFY]', {
      success: false,
      errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const matching = jwks.keys?.find((key) => 'kid' in key && key.kid === header.kid);
  const matchingKey = Boolean(matching);
  const timing = claimTiming(unverified);
  const base = {
    alg: header.alg ?? null,
    kid: header.kid ?? null,
    matchingKey,
    jwkFingerprint: jwkFingerprint(matching),
    ...timing,
    expectedAudience: TOKEN_AUDIENCE,
  };

  try {
    const { payload } = await jwtVerify(assertion, createLocalJWKSet(jwks), {
      algorithms: ['RS256'],
      issuer: CHATGPT_CLIENT_ID,
      subject: CHATGPT_CLIENT_ID,
      audience: [TOKEN_AUDIENCE, MCP_AUTH_ISSUER],
    });

    console.info('[OPENAI JWKS VERIFY]', {
      ...base,
      success: true,
      iss: payload.iss ?? null,
      sub: payload.sub ?? null,
      aud: payload.aud ?? null,
      hasExp: typeof payload.exp === 'number',
      hasJti: typeof payload.jti === 'string',
      clockTolerance: 0,
    });
  } catch (error) {
    // Prove whether crypto/claims work once small clock skew is allowed.
    try {
      const { payload } = await jwtVerify(assertion, createLocalJWKSet(jwks), {
        algorithms: ['RS256'],
        issuer: CHATGPT_CLIENT_ID,
        subject: CHATGPT_CLIENT_ID,
        audience: [TOKEN_AUDIENCE, MCP_AUTH_ISSUER],
        clockTolerance: 10,
      });
      console.info('[OPENAI JWKS VERIFY]', {
        ...base,
        success: true,
        iss: payload.iss ?? null,
        sub: payload.sub ?? null,
        aud: payload.aud ?? null,
        hasExp: typeof payload.exp === 'number',
        hasJti: typeof payload.jti === 'string',
        clockTolerance: 10,
        note: 'strict verify failed; succeeded with clockTolerance=10',
        strictErrorName: error instanceof Error ? error.name : null,
        strictErrorMessage: error instanceof Error ? error.message : String(error),
      });
      return;
    } catch (tolerantError) {
      console.error('[OPENAI JWKS VERIFY]', {
        ...base,
        success: false,
        errorName: error instanceof Error ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
        tolerantErrorName: tolerantError instanceof Error ? tolerantError.name : null,
        tolerantErrorMessage: tolerantError instanceof Error ? tolerantError.message : String(tolerantError),
      });
    }
  }
}
