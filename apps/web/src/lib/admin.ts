import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { prisma } from '@tactia/database';
import { AuditAction } from '@tactia/domain';
import { auditLogService, syncService } from './services';
import { assertOperator } from './operator';

/**
 * Operações do painel interno (spec §54).
 *
 * Este é o único lugar do sistema que atravessa tenants, então:
 * 1. todo acesso passa por `assertOperator` (allowlist de e-mail);
 * 2. toda ação grava audit log no tenant afetado com `actorType: 'operator'`.
 */

export async function listTenantsOverview(ctx: RequestContext) {
  await assertOperator(ctx);

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      createdAt: true,
      _count: {
        select: { memberships: true, dataSources: true, sales: true, insights: true },
      },
    },
  });

  return tenants;
}

export async function getTenantDetail(ctx: RequestContext, tenantId: string) {
  await assertOperator(ctx);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, slug: true, status: true, currency: true, timezone: true },
  });
  if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, 'Tenant not found');

  const [users, dataSources, syncJobs, imports, insights] = await Promise.all([
    prisma.membership.findMany({
      where: { tenantId },
      select: {
        id: true,
        role: true,
        status: true,
        user: { select: { name: true, email: true } },
      },
    }),
    prisma.dataSource.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, type: true, status: true, lastSyncAt: true },
    }),
    prisma.syncJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: {
        id: true,
        status: true,
        dataSourceId: true,
        recordsRead: true,
        recordsCreated: true,
        recordsUpdated: true,
        recordsFailed: true,
        error: true,
        createdAt: true,
        finishedAt: true,
      },
    }),
    prisma.import.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: {
        id: true,
        entityType: true,
        status: true,
        totalRecords: true,
        dataSourceId: true,
        createdAt: true,
      },
    }),
    prisma.insight.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        severity: true,
        status: true,
        ruleKey: true,
        createdAt: true,
      },
    }),
  ]);

  return { tenant, users, dataSources, syncJobs, imports, insights };
}

/**
 * Dispara um sync em nome do tenant. O contexto é reconstruído com o tenant
 * alvo — o operador age como owner naquele tenant, e o audit log registra isso.
 */
export async function operatorTriggerSync(
  ctx: RequestContext,
  input: { tenantId: string; dataSourceId: string },
) {
  await assertOperator(ctx);

  const dataSource = await prisma.dataSource.findFirst({
    where: { id: input.dataSourceId, tenantId: input.tenantId },
    select: { id: true },
  });
  if (!dataSource) throw new AppError(ErrorCode.NOT_FOUND, 'DataSource not found');

  const operatorCtx: RequestContext = {
    requestId: ctx.requestId,
    tenantId: input.tenantId,
    userId: ctx.userId,
    role: 'owner',
    ip: ctx.ip ?? null,
  };

  await auditLogService.record(operatorCtx, {
    action: AuditAction.SYNC_STARTED,
    entityType: 'data_source',
    entityId: input.dataSourceId,
    actorType: 'operator',
    metadata: { triggeredBy: 'admin_panel' },
  });

  return syncService.startSync(operatorCtx, input.dataSourceId);
}

/**
 * Reprocessa um import: no modelo da V0.1 isso significa rodar o sync da fonte
 * de origem novamente — a idempotência por `(tenant, data_source, external_id)`
 * garante que nada duplica (spec §38).
 */
export async function operatorReprocessImport(
  ctx: RequestContext,
  input: { tenantId: string; importId: string },
) {
  await assertOperator(ctx);

  const record = await prisma.import.findFirst({
    where: { id: input.importId, tenantId: input.tenantId },
    select: { id: true, dataSourceId: true, entityType: true },
  });
  if (!record) throw new AppError(ErrorCode.NOT_FOUND, 'Import not found');

  const operatorCtx: RequestContext = {
    requestId: ctx.requestId,
    tenantId: input.tenantId,
    userId: ctx.userId,
    role: 'owner',
    ip: ctx.ip ?? null,
  };

  await auditLogService.record(operatorCtx, {
    action: AuditAction.SYNC_STARTED,
    entityType: 'import',
    entityId: record.id,
    actorType: 'operator',
    metadata: { reprocess: true, entityType: record.entityType },
  });

  return syncService.startSync(operatorCtx, record.dataSourceId);
}
