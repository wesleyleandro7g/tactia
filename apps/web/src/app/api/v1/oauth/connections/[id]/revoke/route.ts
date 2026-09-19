import { prisma } from '@tactia/database';
import { AuditAction, hasMinRole } from '@tactia/domain';
import { AppError, ErrorCode } from '@tactia/shared';
import { createApiHandler } from '@/lib/api';
import { auditLogService } from '@/lib/services';

export const POST = createApiHandler({ auth: 'tenant' }, async (_request, ctx, params) => {
  const consent = await prisma.oauthConsent.findFirst({
    where: { id: params.id ?? '', referenceId: ctx.tenantId },
  });
  if (!consent) throw new AppError(ErrorCode.NOT_FOUND, 'Conexão não encontrada');

  const currentUser = await prisma.user.findUnique({
    where: { id: ctx.userId! },
    select: { externalAuthId: true },
  });
  const ownsConnection = currentUser?.externalAuthId === consent.userId;
  if (!ownsConnection && !hasMinRole(ctx.role!, 'admin')) {
    throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Sem permissão para revogar esta conexão');
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.oauthAccessToken.updateMany({
      where: {
        clientId: consent.clientId,
        userId: consent.userId,
        referenceId: ctx.tenantId,
        revoked: null,
      },
      data: { revoked: now },
    }),
    prisma.oauthRefreshToken.updateMany({
      where: {
        clientId: consent.clientId,
        userId: consent.userId ?? '',
        referenceId: ctx.tenantId,
        revoked: null,
      },
      data: { revoked: now },
    }),
    prisma.oauthConsent.delete({ where: { id: consent.id } }),
  ]);

  await auditLogService.record(ctx, {
    action: AuditAction.MCP_CONNECTION_REVOKED,
    entityType: 'oauth_consent',
    entityId: consent.id,
    metadata: { clientId: consent.clientId, connectionUserId: consent.userId },
  });
  return { id: consent.id, revokedAt: now.toISOString() };
});
