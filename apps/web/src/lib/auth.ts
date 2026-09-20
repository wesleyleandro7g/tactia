import { betterAuth } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { prisma } from '@tactia/database';
import { cimd } from '@better-auth/cimd';
import { mcp } from '@better-auth/mcp';
import { getOAuthProviderState } from '@better-auth/oauth-provider';
import { jwt } from 'better-auth/plugins';
import { getMcpCompany, selectMcpCompany } from './mcp-oauth-selection';
import {
  MCP_AUTH_ISSUER,
  MCP_DOMAIN_USER_CLAIM,
  MCP_CONSENT_CLAIM,
  MCP_RESOURCE_URL,
  MCP_ROLE_CLAIM,
  MCP_GRANT_SCOPES,
  MCP_SCOPES,
  MCP_TENANT_CLAIM,
  isChatGptClientMetadataUrl,
} from './mcp-auth';
import {
  describeClientAssertion,
  describeTokenRequestBody,
  describeTokenReturned,
  logClientAssertion,
  logTokenRequest,
  logTokenResponse,
} from './mcp-oauth-debug';
import { debugCimdFetch, debugVerifyChatGPTAssertion } from './mcp-oauth-jwks-debug';

const secret = process.env.BETTER_AUTH_SECRET;
const baseURL = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
/** Temporary ChatGPT MCP token diagnostics — set MCP_OAUTH_DEBUG=0 to silence Better Auth debug noise. */
const mcpOAuthDebug = process.env.MCP_OAUTH_DEBUG !== '0';

if (process.env.NODE_ENV === 'production' && (!secret || secret.length < 32)) {
  throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters in production');
}

if (!secret && process.env.NODE_ENV !== 'test') {
  console.warn('BETTER_AUTH_SECRET is not set');
}

export const auth = betterAuth({
  appName: 'Tactia',
  baseURL,
  basePath: '/api/v1/auth',
  secret: secret ?? 'dev-only-secret-replace-before-production-32',
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  logger: {
    level: mcpOAuthDebug ? 'debug' : 'warn',
    disabled: false,
    log(level, message, ...args) {
      // Temporary: surface Better Auth internals for ChatGPT MCP token failures.
      console.log('[BETTER AUTH]', { level, message, args });
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/oauth2/token') return;
      const body = ctx.body as Record<string, unknown> | undefined;
      logTokenRequest(describeTokenRequestBody(body, ctx.headers));
      const assertion = typeof body?.client_assertion === 'string' ? body.client_assertion : null;
      const assertionMeta = describeClientAssertion(assertion);
      if (assertionMeta) logClientAssertion(assertionMeta);
      if (assertion) await debugVerifyChatGPTAssertion(assertion);
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/oauth2/token') return;
      logTokenResponse(describeTokenReturned(ctx.context.returned));
    }),
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
  },
  user: {
    modelName: 'authUser',
  },
  session: {
    modelName: 'authSession',
  },
  account: {
    modelName: 'authAccount',
  },
  verification: {
    modelName: 'authVerification',
  },
  trustedOrigins: [baseURL],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const { userService } = await import('./services');
          await userService.ensureFromExternalAuth({
            externalAuthId: user.id,
            name: user.name,
            email: user.email,
            avatarUrl: user.image,
          });
        },
      },
    },
  },
  plugins: [
    jwt({
      jwt: { issuer: MCP_AUTH_ISSUER },
      // ChatGPT verifies the OIDC id_token after /oauth2/token. EdDSA (Better Auth
      // default) is rejected by that client; RS256 is the interoperable alg.
      jwks: { keyPairConfig: { alg: 'RS256', modulusLength: 2048 } },
    }),
    mcp({
      loginPage: '/login',
      consentPage: '/oauth/consent',
      resource: MCP_RESOURCE_URL,
      resources: [
        {
          identifier: MCP_RESOURCE_URL,
          name: 'Tactia MCP',
          allowedScopes: [...MCP_GRANT_SCOPES],
        },
      ],
      scopes: [...MCP_GRANT_SCOPES],
      grantTypes: ['authorization_code', 'refresh_token'],
      accessTokenExpiresIn: 10 * 60,
      refreshTokenExpiresIn: 30 * 24 * 60 * 60,
      codeExpiresIn: 5 * 60,
      refreshTokenReuseInterval: 0,
      postLogin: {
        page: '/oauth/select-company',
        async shouldRedirect({ user, session }) {
          const memberships = await prisma.membership.findMany({
            where: {
              user: { externalAuthId: user.id, deletedAt: null },
              status: 'active',
              deletedAt: null,
              tenant: { status: 'active' },
            },
            select: { tenantId: true },
          });
          if (memberships.length === 1) {
            const state = await getOAuthProviderState();
            await selectMcpCompany(session.id, new URLSearchParams(state?.query), memberships[0]!.tenantId);
            return false;
          }
          return true;
        },
        async consentReferenceId({ user, session, scopes }) {
          const state = await getOAuthProviderState();
          const selectedTenantId = await getMcpCompany(session.id, new URLSearchParams(state?.query));
          if (!selectedTenantId) throw new Error('Selecione uma empresa para continuar.');
          const membership = await prisma.membership.findFirst({
            where: {
              tenantId: selectedTenantId,
              user: { externalAuthId: user.id, deletedAt: null },
              status: 'active',
              deletedAt: null,
              tenant: { status: 'active' },
            },
          });
          if (!membership) throw new Error('A empresa selecionada não está disponível.');
          if (scopes.includes(MCP_SCOPES.propose) && membership.role === 'viewer') {
            throw new Error('Seu papel não permite propor ações nesta empresa.');
          }
          return selectedTenantId;
        },
      },
      extensions: [{
        claims: {
          async accessToken({ user, client, referenceId }) {
            if (!user || !referenceId) throw new Error('Autorização incompleta.');
            const consent = await prisma.oauthConsent.findFirst({
              where: { clientId: client.clientId, userId: user.id, referenceId },
            });
            if (!consent) throw new Error('Conexão OAuth revogada.');
            // A new consent must never reactivate JWTs from a revoked connection.
            return { [MCP_CONSENT_CLAIM]: consent.id };
          },
        },
      }],
      async customAccessTokenClaims({ user, referenceId }) {
        if (!user || !referenceId) throw new Error('Autorização sem usuário ou empresa.');
        const membership = await prisma.membership.findFirst({
          where: {
            tenantId: referenceId,
            user: { externalAuthId: user.id, deletedAt: null },
            status: 'active',
            deletedAt: null,
            tenant: { status: 'active' },
          },
          include: { user: true },
        });
        if (!membership) throw new Error('Acesso à empresa revogado.');
        return {
          [MCP_TENANT_CLAIM]: membership.tenantId,
          [MCP_ROLE_CLAIM]: membership.role,
          [MCP_DOMAIN_USER_CLAIM]: membership.userId,
        };
      },
    }),
    cimd({
      fetchClientMetadataResource: debugCimdFetch,
      metadataProfile: 'mcp-2026-07-28',
      isMetadataDocumentUrlAllowed: (url) => isChatGptClientMetadataUrl(url),
    }),
    nextCookies(),
  ],
});
