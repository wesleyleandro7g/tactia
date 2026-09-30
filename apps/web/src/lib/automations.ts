import { prisma, ScheduleOccurrenceRepository, ScheduleRepository, CredentialRepository } from '@tactia/database';
import { EmailConfigService, encrypt, decrypt } from '@tactia/domain';
import {
  AutomationService,
  PrismaAutomationStore,
  createPublishedWorkflowRunner,
  createReportsPortalBrowser,
  effectProposalFromAction,
  loadAutomationAttachments,
} from '@tactia/execution';
import { logger } from '@tactia/shared';
import { createObjectStorageFromEnv, storageKey } from '@tactia/shared/storage';
import { auditLogService, executionEngine } from './services';
import { getJobQueue, JOBS } from './jobs';

const storage = createObjectStorageFromEnv();
const schedules = new ScheduleRepository(prisma);
const occurrences = new ScheduleOccurrenceRepository(prisma);
const emailConfig = new EmailConfigService(new CredentialRepository(prisma));

export const automationService = new AutomationService({
  store: new PrismaAutomationStore(prisma),
  storage: {
    async put({ tenantId, id, body, contentType }) {
      const key = storageKey({ tenantId, kind: 'integration-artifact', id, ext: 'csv' });
      await storage.put({ key, body, contentType });
      return { key };
    },
    get: (key) => storage.get(key),
  },
  cipher: { encrypt, decrypt },
  audit: {
    async record(ctx, entry) {
      await auditLogService.record(ctx, entry);
    },
  },
  emailDriver: async (tenantId) => ((await emailConfig.getResolvedForTenant(tenantId)) ? 'smtp' : 'console'),
  revisions: {
    async pin(tenantId, workflowKey, workflowVersion) {
      const workflow = await prisma.browserWorkflow.findFirst({
        where: { tenantId, workflowKey, active: true },
        include: { activeRevision: true },
      });
      const revision = workflow?.activeRevision;
      if (!revision || revision.workflowVersion !== workflowVersion) return null;
      return revision.id;
    },
  },
  browser: createReportsPortalBrowser(prisma, createPublishedWorkflowRunner(prisma, decrypt)),
  schedules: {
    async onRunSettled(input) {
      const occurrence = await occurrences.findById({ tenantId: input.tenantId, id: input.occurrenceId });
      if (!occurrence || occurrence.status === 'completed' || occurrence.status === 'cancelled') return;
      if (input.status === 'completed') {
        await occurrences.update(
          { tenantId: input.tenantId, id: input.occurrenceId },
          {
            status: 'completed',
            automationRunId: input.runId,
            finishedAt: new Date(),
            output: { runId: input.runId, summary: input.summary },
            error: null,
          },
        );
        const updated = await schedules.incrementSuccess({
          tenantId: input.tenantId,
          id: occurrence.scheduleId,
          at: new Date(),
        });
        if (
          updated.repeatMode === 'count' &&
          updated.maxOccurrences !== null &&
          updated.successCount >= updated.maxOccurrences
        ) {
          await schedules.setEnabled({ tenantId: input.tenantId, id: occurrence.scheduleId, enabled: false });
        }
        return;
      }
      if (input.status === 'failed' || input.status === 'cancelled') {
        await occurrences.update(
          { tenantId: input.tenantId, id: input.occurrenceId },
          {
            status: input.status === 'cancelled' ? 'cancelled' : 'failed',
            automationRunId: input.runId,
            finishedAt: new Date(),
            error: input.summary,
          },
        );
        return;
      }
      await occurrences.update(
        { tenantId: input.tenantId, id: input.occurrenceId },
        { status: 'running', automationRunId: input.runId, output: { runId: input.runId, status: input.status } },
      );
    },
  },
  effects: {
    async propose(input) {
      const execution = await executionEngine.propose(
        input.ctx,
        {
          actionType: 'send_email',
          input: input.email,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
        },
        { origin: input.origin, forceExecute: input.forceExecute },
      );
      return effectProposalFromAction(execution);
    },
    async lookup(tenantId, actionExecutionId) {
      const execution = await prisma.actionExecution.findFirst({
        where: { id: actionExecutionId, tenantId },
        include: { approvals: true },
      });
      if (!execution) return null;
      return effectProposalFromAction(execution);
    },
    async cancel(tenantId, actionExecutionId) {
      const execution = await prisma.actionExecution.findFirst({ where: { id: actionExecutionId, tenantId } });
      if (!execution || execution.status === 'completed') return;
      await prisma.actionExecution.update({
        where: { id: actionExecutionId },
        data: { status: 'cancelled', finishedAt: new Date() },
      });
    },
  },
  publish: async (job) => {
    const queue = getJobQueue();
    if (queue?.isStarted) {
      await queue.publish(
        JOBS.automationRun,
        { tenantId: job.tenantId, runId: job.runId },
        {
          singletonKey: job.runId,
          ...(job.startAfterMs ? { startAfter: Math.ceil(job.startAfterMs / 1000) } : {}),
        },
      );
      return;
    }
    const delay = job.startAfterMs ?? 0;
    setTimeout(() => {
      void automationService.execute(job.tenantId, job.runId).catch((error: unknown) => {
        logger.error({
          operation: 'automation_inline_execute',
          tenant_id: job.tenantId,
          run_id: job.runId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, delay);
  },
});

executionEngine.setSettlementListener(async (event) => {
  await automationService.onExecutionSettled(event.tenantId, event.executionId);
});

export async function loadAutomationAttachmentsForTenant(tenantId: string, artifactIds: string[]) {
  return loadAutomationAttachments({ db: prisma, storage, tenantId, artifactIds });
}

export async function sweepAutomationApprovals() {
  const steps = await prisma.automationStepRun.findMany({
    where: { status: { in: ['awaiting_approval', 'running'] }, actionExecutionId: { not: null } },
    take: 50,
  });
  for (const step of steps) {
    if (step.actionExecutionId) {
      await automationService.onExecutionSettled(step.tenantId, step.actionExecutionId);
    }
  }
  return automationService.recoverAndDispatch();
}
