import { MembershipRepository, ScheduleOccurrenceRepository, ScheduleRepository, prisma } from '@tactia/database';
import { ScheduleService } from '@tactia/domain';
import { ScheduleRunner, type ScheduleAgentRunner } from '@tactia/execution';
import type { SchedulePort, ToolContext } from '@tactia/ai';
import { AppError, ErrorCode, logger } from '@tactia/shared';
import { auditLogService, executionEngine, tenantRepository } from './services';
import { getJobQueue, JOBS, type ScheduleRunJob } from './jobs';

const scheduleRepository = new ScheduleRepository(prisma);
const scheduleOccurrenceRepository = new ScheduleOccurrenceRepository(prisma);
const membershipRepository = new MembershipRepository(prisma);

/**
 * Resolves a real principal for the headless agent run. The AI layer (context
 * builder + tools) reads tenant data through domain services that require an
 * authenticated user or operator (`assertAuthenticated`/tenant scope). A
 * schedule run has no HTTP session, so we act as the tenant's owner — the
 * highest-privilege member — whose membership the read path validates.
 */
async function resolveScheduleAgentContext(
  tenantId: string,
  requestId: string,
): Promise<ToolContext> {
  const page = await membershipRepository.listByTenant({ tenantId, skip: 0, take: 100 });
  const active = page.items.filter((m) => m.status === 'active');
  const principal =
    active.find((m) => m.role === 'owner') ??
    active.find((m) => m.role === 'admin') ??
    active[0];
  if (!principal) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'Nenhum usuário ativo para executar o agente neste agendamento.',
    );
  }
  return {
    requestId,
    tenantId,
    userId: principal.userId,
    role: principal.role,
    operatorId: null,
    ip: null,
  };
}

/**
 * Agent runner for `target: ai_agent` schedules. Runs one headless Orchestrator
 * turn using the schedule's `aiConfig` as the question, then returns a compact
 * summary to persist on the occurrence. Any side effect the agent proposes goes
 * through the ExecutionEngine (respecting `effectMode`) — never directly.
 */
const scheduleAgentRunner: ScheduleAgentRunner = {
  async run({ ctx, scheduleId, aiConfig }) {
    // Lazy import breaks the cycle: ai.ts wires the schedulePort from here.
    const { chatRuntime } = await import('./ai');

    // The AI read path needs a real principal; act as the tenant owner.
    const toolCtx = await resolveScheduleAgentContext(ctx.tenantId as string, ctx.requestId);

    const question = aiConfig.systemPrompt
      ? `${aiConfig.systemPrompt}\n\n${aiConfig.instruction}`
      : aiConfig.instruction;

    const answer = await chatRuntime.getOrchestrator().run({
      ctx: toolCtx,
      question,
      history: [],
    });

    logger.info({
      tenant_id: ctx.tenantId,
      operation: 'schedule_agent_run',
      schedule_id: scheduleId,
      proposals: answer.proposals?.length ?? 0,
      tool_calls: answer.toolCalls?.length ?? 0,
    });

    return {
      summary: answer.resolution === 'clarification'
        ? `Informação pendente para aprofundar a análise: ${answer.content}`
        : answer.content,
      proposals: answer.proposals?.length ?? 0,
      toolCalls: answer.toolCalls?.map((call) => call.name) ?? [],
      provider: answer.provider,
      model: answer.model,
    };
  },
};

async function enqueueScheduleRun(job: ScheduleRunJob): Promise<void> {
  const queue = getJobQueue();
  if (!queue) {
    // Inline fallback (dev/serverless without JOBS_ENABLED).
    await scheduleRunner.run(job.tenantId, job.occurrenceId, job.requestId);
    return;
  }
  await queue.publish<ScheduleRunJob>(JOBS.scheduleRun, job, { singletonKey: job.occurrenceId });
}

export const scheduleService = new ScheduleService({
  schedules: scheduleRepository,
  occurrences: scheduleOccurrenceRepository,
  auditLogs: auditLogService,
  tenantTimezone: async (tenantId) => {
    const tenant = await tenantRepository.findById({ tenantId });
    return tenant?.timezone;
  },
  enqueueRun: async ({ tenantId, scheduleId, occurrenceId, periodKey }) => {
    await enqueueScheduleRun({
      tenantId,
      scheduleId,
      occurrenceId,
      periodKey,
      requestId: `schedule-${occurrenceId}`,
    });
  },
});

export const scheduleRunner = new ScheduleRunner({
  schedules: scheduleRepository,
  occurrences: scheduleOccurrenceRepository,
  engine: executionEngine,
  auditLogs: auditLogService,
  agentRunner: scheduleAgentRunner,
  automationRunner: {
    async start(input) {
      const { automationService } = await import('./automations');
      const run = await automationService.start(input.ctx, {
        automationId: input.automationId,
        params: input.params,
        origin: 'schedule',
        originRef: input.scheduleId,
        idempotencyKey: `schedule:${input.occurrenceId}`,
        scheduleOccurrenceId: input.occurrenceId,
        forceApproval: input.effectMode === 'propose',
      });
      return { id: run.id, status: run.status };
    },
  },
});

/**
 * Port consumed by the chat schedule tools. The assistant manages schedules
 * directly (self-service); `actorType: 'ai'` keeps the audit trail honest.
 */
export const schedulePort: SchedulePort = {
  async create(ctx, input) {
    const schedule = await scheduleService.create(ctx, input, { actorType: 'ai' });
    return { id: schedule.id, name: schedule.name, enabled: schedule.enabled };
  },
  async list(ctx, query) {
    const result = await scheduleService.list(ctx, query);
    return {
      items: result.items.map((s) => ({
        id: s.id,
        name: s.name,
        target: s.target,
        frequency: s.frequency,
        enabled: s.enabled,
      })),
      total: result.total,
    };
  },
  async update(ctx, id, input) {
    const schedule = await scheduleService.update(ctx, id, input, { actorType: 'ai' });
    return { id: schedule.id, name: schedule.name, enabled: schedule.enabled };
  },
  async setEnabled(ctx, id, enabled) {
    const schedule = await scheduleService.setEnabled(ctx, id, enabled, { actorType: 'ai' });
    return { id: schedule.id, enabled: schedule.enabled };
  },
  async triggerNow(ctx, id) {
    const occurrence = await scheduleService.triggerNow(ctx, id, { actorType: 'ai' });
    return { id: occurrence.id, status: occurrence.status, periodKey: occurrence.periodKey };
  },
};

export { scheduleRepository, scheduleOccurrenceRepository };
