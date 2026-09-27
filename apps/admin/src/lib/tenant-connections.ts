import { prisma } from '@tactia/database';
import { AuditAction } from '@tactia/domain';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { chatServices } from './chat';
import { scopedTenant } from './settings-services';

function clientNameFromMetadata(metadata: unknown): string {
  if (metadata && typeof metadata === 'object' && 'client_name' in metadata) {
    const name = (metadata as { client_name?: unknown }).client_name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return 'Aplicativo MCP';
}

export async function listTenantConnections(ctx: RequestContext, tenantId: string) {
  await scopedTenant(ctx, tenantId);
  const consents = await prisma.oauthConsent.findMany({
    where: { referenceId: tenantId },
    include: {
      client: { select: { name: true, uri: true, metadata: true } },
      user: { select: { name: true, email: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
  return consents.map((consent) => ({
    id: consent.id,
    clientName: consent.client.name || clientNameFromMetadata(consent.client.metadata),
    clientUri: consent.client.uri,
    userName: consent.user?.name ?? 'Usuário removido',
    userEmail: consent.user?.email ?? null,
    scopes: consent.scopes,
    connectedAt: (consent.updatedAt ?? consent.createdAt ?? new Date(0)).toISOString(),
  }));
}

/**
 * Company-level revoke: the operator manages the whole tenant, so any consent
 * for the tenant can be revoked (no per-user ownership check). Tokens are
 * invalidated immediately, mirroring the client app's revoke.
 */
export async function revokeTenantConnection(ctx: RequestContext, tenantId: string, consentId: string) {
  const scoped = await scopedTenant(ctx, tenantId);
  const consent = await prisma.oauthConsent.findFirst({
    where: { id: consentId, referenceId: tenantId },
  });
  if (!consent) throw new AppError(ErrorCode.NOT_FOUND, 'Conexão não encontrada');

  const now = new Date();
  await prisma.$transaction([
    prisma.oauthAccessToken.updateMany({
      where: { clientId: consent.clientId, userId: consent.userId, referenceId: tenantId, revoked: null },
      data: { revoked: now },
    }),
    prisma.oauthRefreshToken.updateMany({
      where: { clientId: consent.clientId, userId: consent.userId ?? '', referenceId: tenantId, revoked: null },
      data: { revoked: now },
    }),
    prisma.oauthConsent.delete({ where: { id: consent.id } }),
  ]);

  await chatServices.auditLogService.record(scoped, {
    action: AuditAction.MCP_CONNECTION_REVOKED,
    entityType: 'oauth_consent',
    entityId: consent.id,
    metadata: { clientId: consent.clientId, connectionUserId: consent.userId },
  });
  return { id: consent.id, revokedAt: now.toISOString() };
}
