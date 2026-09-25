import { createId } from '@tactia/shared';
import type { PrismaClient } from '../client';

export type UpsertBrowserWorkflowBindingInput = {
  provider: string;
  engine: string;
  workflowKey: string;
  workflowVersion: string;
  environment: string;
  instanceKey: string;
  externalTaskId: string;
  definitionChecksum?: string | null;
  tenantId?: string | null;
  reconciliationMarker?: string | null;
  browserExecutorInstanceId?: string | null;
  workflowRevisionId?: string | null;
};

export class BrowserWorkflowBindingRepository {
  constructor(private readonly db: PrismaClient) {}

  async upsert(input: UpsertBrowserWorkflowBindingInput) {
    const identity = {
      provider: input.provider,
      engine: input.engine,
      workflowKey: input.workflowKey,
      workflowVersion: input.workflowVersion,
      environment: input.environment,
      instanceKey: input.instanceKey,
    };
    return this.db.browserWorkflowBinding.upsert({
      where: { provider_engine_workflowKey_workflowVersion_environment_instanceKey: identity },
      create: {
        id: createId(),
        ...input,
        definitionChecksum: input.definitionChecksum ?? null,
        tenantId: input.tenantId ?? null,
        reconciliationMarker: input.reconciliationMarker ?? null,
        browserExecutorInstanceId: input.browserExecutorInstanceId ?? null,
        workflowRevisionId: input.workflowRevisionId ?? null,
      },
      update: {
        externalTaskId: input.externalTaskId,
        definitionChecksum: input.definitionChecksum ?? null,
        active: true,
        ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
        ...(input.reconciliationMarker !== undefined ? { reconciliationMarker: input.reconciliationMarker } : {}),
        ...(input.browserExecutorInstanceId !== undefined ? { browserExecutorInstanceId: input.browserExecutorInstanceId } : {}),
        ...(input.workflowRevisionId !== undefined ? { workflowRevisionId: input.workflowRevisionId } : {}),
      },
    });
  }

  async replaceActive(input: UpsertBrowserWorkflowBindingInput & { tenantId: string }) {
    return this.db.$transaction(async (tx) => {
      await tx.browserWorkflowBinding.updateMany({
        where: {
          tenantId: input.tenantId,
          provider: input.provider,
          engine: input.engine,
          workflowKey: input.workflowKey,
          environment: input.environment,
          instanceKey: input.instanceKey,
          active: true,
        },
        data: { active: false },
      });
      const identity = {
        provider: input.provider,
        engine: input.engine,
        workflowKey: input.workflowKey,
        workflowVersion: input.workflowVersion,
        environment: input.environment,
        instanceKey: input.instanceKey,
      };
      return tx.browserWorkflowBinding.upsert({
        where: { provider_engine_workflowKey_workflowVersion_environment_instanceKey: identity },
        create: {
          id: createId(),
          ...input,
          definitionChecksum: input.definitionChecksum ?? null,
          reconciliationMarker: input.reconciliationMarker ?? null,
          browserExecutorInstanceId: input.browserExecutorInstanceId ?? null,
          workflowRevisionId: input.workflowRevisionId ?? null,
          active: true,
        },
        update: {
          externalTaskId: input.externalTaskId,
          definitionChecksum: input.definitionChecksum ?? null,
          reconciliationMarker: input.reconciliationMarker ?? null,
          browserExecutorInstanceId: input.browserExecutorInstanceId ?? null,
          workflowRevisionId: input.workflowRevisionId ?? null,
          tenantId: input.tenantId,
          active: true,
        },
      });
    });
  }

  async findByMarker({ environment, instanceKey, reconciliationMarker }: { environment: string; instanceKey: string; reconciliationMarker: string }) {
    return this.db.browserWorkflowBinding.findFirst({
      where: { environment, instanceKey, reconciliationMarker },
    });
  }

  async listActive({ provider, environment, instanceKey }: { provider: string; environment: string; instanceKey: string }) {
    return this.db.browserWorkflowBinding.findMany({
      where: { provider, environment, instanceKey, active: true },
      orderBy: [{ workflowKey: 'asc' }, { workflowVersion: 'asc' }],
    });
  }

  async listActiveForTenant({ tenantId, provider, environment, instanceKey }: { tenantId: string; provider: string; environment: string; instanceKey: string }) {
    return this.db.browserWorkflowBinding.findMany({
      where: { tenantId, provider, environment, instanceKey, active: true },
      orderBy: [{ workflowKey: 'asc' }, { workflowVersion: 'asc' }],
    });
  }
}
