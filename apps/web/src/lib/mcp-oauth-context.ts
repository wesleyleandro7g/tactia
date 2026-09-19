import { prisma } from '@tactia/database';
import { AppError, ErrorCode, REQUEST_ID_HEADER, createId, type RequestContext } from '@tactia/shared';
import { getClientIp } from './api';
import {
  MCP_DOMAIN_USER_CLAIM,
  MCP_CONSENT_CLAIM,
  MCP_RESOURCE_URL,
  MCP_TENANT_CLAIM,
  parseOAuthScopes,
  type McpAccessClaims,
} from './mcp-auth';

export type OAuthMcpContext = RequestContext & {
  tenantId: string;
  userId: string;
  role: NonNullable<RequestContext['role']>;
  mcpClientId: string;
  mcpAuthorizationId: string;
  apiKeyScopes: string[];
  profile: { id: string; name: string; email: string; nickname: string };
};

export async function resolveOAuthMcpContext(
  request: Request,
  payload: Record<string, unknown>,
): Promise<OAuthMcpContext> {
  const claims = payload as McpAccessClaims;
  const externalAuthId = claims.sub;
  const tenantId = claims[MCP_TENANT_CLAIM];
  const clientId = typeof claims.client_id === 'string' ? claims.client_id : null;
  const consentId = claims[MCP_CONSENT_CLAIM];
  if (!externalAuthId || !tenantId || !clientId || !consentId) {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'OAuth token incompleto');
  }

  const membership = await prisma.membership.findFirst({
    where: {
      tenantId,
      status: 'active',
      deletedAt: null,
      tenant: { status: 'active' },
      user: { externalAuthId, deletedAt: null },
    },
    include: { tenant: true, user: true },
  });
  if (!membership) {
    throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Acesso à empresa revogado');
  }

  const consent = await prisma.oauthConsent.findFirst({
    where: {
      id: consentId,
      clientId,
      userId: externalAuthId,
      referenceId: tenantId,
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (!consent || !consent.resources.includes(MCP_RESOURCE_URL)) {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Conexão OAuth revogada');
  }

  const domainClaim = claims[MCP_DOMAIN_USER_CLAIM];
  if (domainClaim && domainClaim !== membership.userId) {
    throw new AppError(ErrorCode.AUTHENTICATION_ERROR, 'Identidade OAuth inválida');
  }

  // Membership IDs are immutable opaque IDs for the complete user/company
  // profile, stable across token rotation, reconnection and display-name edits.
  const profileId = `prf_${membership.id}`;

  return {
    requestId: request.headers.get(REQUEST_ID_HEADER) || createId(),
    tenantId: membership.tenantId,
    userId: membership.userId,
    role: membership.role,
    ip: getClientIp(request),
    mcpClientId: clientId,
    mcpAuthorizationId: consent.id,
    apiKeyId: `oauth:${consent.id}`,
    apiKeyScopes: parseOAuthScopes(claims.scope).filter((scope) => consent.scopes.includes(scope)),
    profile: {
      id: profileId,
      name: membership.user.name,
      email: membership.user.email,
      nickname: `${membership.user.name} — ${membership.tenant.name}`,
    },
  };
}
