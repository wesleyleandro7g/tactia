import { prisma } from '@tactia/database';
import { AppError, ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { scopedTenant } from './settings-services';

export async function getCommandCenterRelease(ctx: RequestContext, tenantId: string) {
  await scopedTenant(ctx, tenantId);
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { commandCenterEnabled: true },
  });
  return { enabled: tenant.commandCenterEnabled };
}

export async function setCommandCenterRelease(ctx: RequestContext, tenantId: string, raw: unknown) {
  const scoped = await scopedTenant(ctx, tenantId);
  const enabled = (raw as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== 'boolean') {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'enabled deve ser booleano');
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
    const previous = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { commandCenterEnabled: true },
    });
    if (previous.commandCenterEnabled === enabled) return { enabled };
    await tx.tenant.update({
      where: { id: tenantId },
      data: { commandCenterEnabled: enabled },
    });
    await tx.auditLog.create({
      data: {
        id: createId(),
        tenantId,
        operatorId: scoped.operatorId,
        userId: null,
        ip: scoped.ip,
        actorType: 'operator',
        action: 'COMMAND_CENTER_RELEASE_CHANGED',
        entityType: 'tenant',
        entityId: tenantId,
        metadata: { previous: previous.commandCenterEnabled, enabled },
      },
    });
    return { enabled };
  });
}
