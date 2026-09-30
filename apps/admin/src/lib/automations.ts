import { CredentialRepository, prisma, ScheduleOccurrenceRepository, ScheduleRepository } from '@tactia/database';
import { EmailConfigService, encrypt, decrypt } from '@tactia/domain';
import {
  AutomationService,
  PrismaAutomationStore,
  createPublishedWorkflowRunner,
  createReportsPortalBrowser,
  effectProposalFromAction,
} from '@tactia/execution';
import { logger } from '@tactia/shared';
import { createObjectStorageFromEnv, storageKey } from '@tactia/shared/storage';
import { adminChatQueue, chatServices } from './chat';
import { auditLogService } from './services';

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
          { status: 'completed', automationRunId: input.runId, finishedAt: new Date(), error: null },
        );
        const updated = await schedules.incrementSuccess({ tenantId: input.tenantId, id: occurrence.scheduleId, at: new Date() });
        if (updated.repeatMode === 'count' && updated.maxOccurrences !== null && updated.successCount >= updated.maxOccurrences) {
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
      }
    },
  },
  effects: {
    async propose(input) {
      const execution = await chatServices.executionEngine.propose(
        input.ctx,
        { actionType: 'send_email', input: input.email, idempotencyKey: input.idempotencyKey, reason: input.reason },
        { origin: input.origin, forceExecute: input.forceExecute },
      );
      return effectProposalFromAction(execution);
    },
    async lookup(tenantId, actionExecutionId) {
      const execution = await prisma.actionExecution.findFirst({
        where: { id: actionExecutionId, tenantId },
        include: { approvals: true },
      });
      return execution ? effectProposalFromAction(execution) : null;
    },
  },
  publish: async (job) => {
    const queue = adminChatQueue();
    if (queue) {
      await queue.start();
      await queue.publish('automation.run', { tenantId: job.tenantId, runId: job.runId }, { singletonKey: job.runId });
      return;
    }
    setTimeout(() => {
      void automationService.execute(job.tenantId, job.runId).catch((error: unknown) => {
        logger.error({
          operation: 'automation_inline_execute',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, job.startAfterMs ?? 0);
  },
});

chatServices.executionEngine.setSettlementListener(async (event) => {
  await automationService.onExecutionSettled(event.tenantId, event.executionId);
});
