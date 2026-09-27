import { createId } from '@tactia/shared';
import type { PrismaClient, Prisma } from '../client';

export type BrowserWorkflowIdentity = {
  tenantId: string;
  provider: string;
  engine: string;
  workflowKey: string;
  environment: string;
};

export type AddRevisionInput = {
  workflowVersion: string;
  definition: Prisma.InputJsonValue;
  definitionChecksum: string;
  publishable: boolean;
  createdBy?: string | null;
};

/**
 * Logical workflows and their append-only revisions. Importing a new JSON
 * definition never mutates an existing revision — it inserts a new one and
 * repoints the workflow's active revision (substitutive on the UI, immutable
 * internally).
 */
export class BrowserWorkflowRepository {
  constructor(private readonly db: PrismaClient) {}

  async findByIdentity(identity: BrowserWorkflowIdentity) {
    return this.db.browserWorkflow.findFirst({
      where: identity,
      include: { activeRevision: true },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.browserWorkflow.findFirst({
      where: { id, tenantId },
      include: { activeRevision: true },
    });
  }

  async listActive({ tenantId, provider, environment }: { tenantId: string; provider: string; environment: string }) {
    return this.db.browserWorkflow.findMany({
      where: { tenantId, provider, environment, active: true },
      include: { activeRevision: true },
      orderBy: { workflowKey: 'asc' },
    });
  }

  async getRevision({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.browserWorkflowRevision.findFirst({ where: { id, tenantId } });
  }

  async listRevisions({ tenantId, workflowId }: { tenantId: string; workflowId: string }) {
    return this.db.browserWorkflowRevision.findMany({
      where: { tenantId, workflowId },
      orderBy: { revision: 'desc' },
    });
  }

  /**
   * Ensure the logical workflow exists, then append a new immutable revision and
   * mark it active. Runs in a single transaction so the revision counter cannot
   * race. Returns the workflow with its freshly active revision.
   */
  async importRevision(identity: BrowserWorkflowIdentity, input: AddRevisionInput) {
    return this.db.$transaction(async (tx) => {
      let workflow = await tx.browserWorkflow.findFirst({ where: identity });
      if (!workflow) {
        workflow = await tx.browserWorkflow.create({
          data: {
            id: createId(),
            tenantId: identity.tenantId,
            provider: identity.provider,
            engine: identity.engine,
            workflowKey: identity.workflowKey,
            environment: identity.environment,
            active: true,
          },
        });
      }
      const last = await tx.browserWorkflowRevision.findFirst({
        where: { workflowId: workflow.id },
        orderBy: { revision: 'desc' },
      });
      if (last?.definitionChecksum === input.definitionChecksum) {
        const updated = await tx.browserWorkflow.update({
          where: { id: workflow.id },
          data: { activeRevisionId: last.id, active: true },
          include: { activeRevision: true },
        });
        return { workflow: updated, revision: last };
      }
      const nextRevision = (last?.revision ?? 0) + 1;
      const revision = await tx.browserWorkflowRevision.create({
        data: {
          id: createId(),
          workflowId: workflow.id,
          tenantId: identity.tenantId,
          revision: nextRevision,
          workflowVersion: input.workflowVersion,
          definition: input.definition,
          definitionChecksum: input.definitionChecksum,
          publishable: input.publishable,
          createdBy: input.createdBy ?? null,
        },
      });
      const updated = await tx.browserWorkflow.update({
        where: { id: workflow.id },
        data: { activeRevisionId: revision.id, active: true },
        include: { activeRevision: true },
      });
      return { workflow: updated, revision };
    });
  }

  async setActiveRevision({ tenantId, workflowId, revisionId }: { tenantId: string; workflowId: string; revisionId: string }) {
    const revision = await this.db.browserWorkflowRevision.findFirst({
      where: { id: revisionId, workflowId, tenantId },
    });
    if (!revision) return null;
    return this.db.browserWorkflow.update({
      where: { id: workflowId },
      data: { activeRevisionId: revisionId },
      include: { activeRevision: true },
    });
  }
}
