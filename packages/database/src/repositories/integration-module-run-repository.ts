import { createId } from '@tactia/shared';
import type { IntegrationModuleRunStatus, PrismaClient } from '../client';
import { asNullableJson } from '../json';

export type StartIntegrationModuleRunInput = {
  tenantId: string;
  dataSourceId: string;
  syncJobId: string;
  moduleKey: string;
  workflowKey: string;
  workflowVersion: string;
  parserVersion: string;
  leaseOwner: string;
  leaseExpiresAt: Date;
  externalExecutionId: string;
};

export type FinishIntegrationModuleRunInput = {
  syncJobId: string;
  moduleKey: string;
  status: Exclude<IntegrationModuleRunStatus, 'queued' | 'running'>;
  recordsRead: number;
  recordsFailed: number;
  externalExecutionId?: string;
  evidence?: Record<string, unknown>;
  checkpoint?: Record<string, unknown>;
  errorCode?: string;
  safeMessage?: string;
  retryable?: boolean;
};

export class IntegrationModuleRunRepository {
  constructor(private readonly db: PrismaClient) {}

  async start(input: StartIntegrationModuleRunInput) {
    return this.db.integrationModuleRun.upsert({
      where: { syncJobId_moduleKey: { syncJobId: input.syncJobId, moduleKey: input.moduleKey } },
      create: {
        id: createId(),
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId,
        syncJobId: input.syncJobId,
        moduleKey: input.moduleKey,
        status: 'running',
        workflowKey: input.workflowKey,
        workflowVersion: input.workflowVersion,
        parserVersion: input.parserVersion,
        leaseOwner: input.leaseOwner,
        leaseExpiresAt: input.leaseExpiresAt,
        externalExecutionId: input.externalExecutionId,
        startedAt: new Date(),
      },
      update: {
        status: 'running',
        attempt: { increment: 1 },
        workflowKey: input.workflowKey,
        workflowVersion: input.workflowVersion,
        parserVersion: input.parserVersion,
        leaseOwner: input.leaseOwner,
        leaseExpiresAt: input.leaseExpiresAt,
        externalExecutionId: input.externalExecutionId,
        startedAt: new Date(),
        finishedAt: null,
        errorCode: null,
        safeMessage: null,
      },
    });
  }

  async finish(input: FinishIntegrationModuleRunInput) {
    return this.db.integrationModuleRun.update({
      where: { syncJobId_moduleKey: { syncJobId: input.syncJobId, moduleKey: input.moduleKey } },
      data: {
        status: input.status,
        recordsRead: input.recordsRead,
        recordsFailed: input.recordsFailed,
        externalExecutionId: input.externalExecutionId,
        evidence: asNullableJson(input.evidence),
        checkpoint: asNullableJson(input.checkpoint),
        errorCode: input.errorCode,
        safeMessage: input.safeMessage,
        retryable: input.retryable ?? false,
        nextAttemptAt: input.retryable ? new Date(Date.now() + 60_000) : null,
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  }

  async markPublished({ syncJobId, moduleKey, checkpoint }: { syncJobId: string; moduleKey: string; checkpoint: Record<string, unknown> }) {
    return this.db.integrationModuleRun.update({
      where: { syncJobId_moduleKey: { syncJobId, moduleKey } },
      data: { checkpoint: asNullableJson(checkpoint) },
    });
  }

  async listBySyncJob({ tenantId, syncJobId }: { tenantId: string; syncJobId: string }) {
    return this.db.integrationModuleRun.findMany({
      where: { tenantId, syncJobId },
      include: { artifacts: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listByDataSource({ tenantId, dataSourceId, take = 100 }: { tenantId: string; dataSourceId: string; take?: number }) {
    return this.db.integrationModuleRun.findMany({
      where: { tenantId, dataSourceId },
      include: { artifacts: true },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
