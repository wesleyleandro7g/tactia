import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { prisma } from '@tactia/database';
import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
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
  MCP_SCOPES,
  MCP_TENANT_CLAIM,
  isChatGptClientMetadataUrl,
} from './mcp-auth';

const secret = process.env.BETTER_AUTH_SECRET;
const baseURL = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

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
    jwt({ jwt: { issuer: MCP_AUTH_ISSUER } }),
    mcp({
      loginPage: '/login',
      consentPage: '/oauth/consent',
      resource: MCP_RESOURCE_URL,
      resources: [
        {
          identifier: MCP_RESOURCE_URL,
          name: 'Tactia MCP',
          allowedScopes: [MCP_SCOPES.read, MCP_SCOPES.propose],
        },
      ],
      scopes: [
        'openid',
        'profile',
        'email',
        'offline_access',
        MCP_SCOPES.read,
        MCP_SCOPES.propose,
      ],
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
      fetchClientMetadataResource,
      metadataProfile: 'mcp-2026-07-28',
      isMetadataDocumentUrlAllowed: (url) => isChatGptClientMetadataUrl(url),
    }),
    nextCookies(),
  ],
});
