import type {
  ActionType,
  ScheduleOccurrenceRepository,
  ScheduleRepository,
} from '@tactia/database';
import { AuditAction, type AuditLogService } from '@tactia/domain';
import { AppError, ErrorCode, MembershipRole, createId, logger, type RequestContext } from '@tactia/shared';
import type { ExecutionEngine } from './execution-engine';

/**
 * A single AI-agent run requested by a schedule. Implemented in apps/web against
 * the Orchestrator so `@tactia/execution` stays free of the AI dependency. The
 * runner passes the schedule's `aiConfig`; the implementation decides which
 * tools/skills to load and returns a compact result to persist on the
 * occurrence. Any side effect the agent proposes must go through the
 * ExecutionEngine (respecting `effectMode`), never directly.
 */
export interface ScheduleAgentRunner {
  run(input: {
    ctx: RequestContext;
    scheduleId: string;
    occurrenceId: string;
    effectMode: 'propose' | 'auto_execute';
    aiConfig: {
      systemPrompt?: string;
      instruction: string;
      tools?: string[];
      skillIds?: string[];
    };
  }): Promise<Record<string, unknown>>;
}

/** Starts an automation and returns immediately. Success is reported later. */
export interface ScheduleAutomationRunner {
  start(input: {
    ctx: RequestContext;
    scheduleId: string;
    occurrenceId: string;
    automationId: string;
    params: Record<string, unknown>;
    effectMode: 'propose' | 'auto_execute';
  }): Promise<{ id: string; status: string }>;
}

export type ScheduleRunnerDeps = {
  schedules: ScheduleRepository;
  occurrences: ScheduleOccurrenceRepository;
  engine: ExecutionEngine;
  auditLogs: AuditLogService;
  /** Absent = ai_agent schedules fail with a clear "agent runner not wired". */
  agentRunner?: ScheduleAgentRunner;
  /** Absent = automation schedules fail until the automation service is wired. */
  automationRunner?: ScheduleAutomationRunner;
};

/** Synthetic principal for background schedule runs (no HTTP session). */
function systemContext(tenantId: string, requestId: string): RequestContext {
  return {
    requestId,
    tenantId,
    userId: null,
    // No operator/user: a system principal. Authorization for the underlying
    // action already happened when the schedule was created (owner/admin).
    operatorId: null,
    role: MembershipRole.owner,
  };
}

/**
 * Executes one schedule occurrence (Task 4/5). Resolves the schedule target:
 * - `action`    → ExecutionEngine.propose (effectMode controls approval)
 * - `ai_agent`  → ScheduleAgentRunner (Orchestrator headless)
 * - `automation`→ enfileira a automação. Sucesso só quando ela termina.
 *
 * Idempotency: the occurrence already exists (created exclusively per period).
 * A failed run records the error and does NOT count towards the success cap;
 * a successful run bumps `successCount` and disables the schedule once it hits
 * `maxOccurrences` (spec §4.3 / §5).
 */
export class ScheduleRunner {
  constructor(private readonly deps: ScheduleRunnerDeps) {}

  async run(tenantId: string, occurrenceId: string, requestId = createId()) {
    const occurrence = await this.deps.occurrences.findById({ tenantId, id: occurrenceId });
    if (!occurrence) throw new AppError(ErrorCode.NOT_FOUND, 'ScheduleOccurrence não encontrada');

    // Only pending occurrences run. A completed one is never repeated (§5.1);
    // a reset deletes it so a fresh occurrence is created instead.
    if (occurrence.status !== 'pending') {
      logger.info({
        tenant_id: tenantId,
        operation: 'schedule_run_skip',
        occurrence_id: occurrenceId,
        status: occurrence.status,
      });
      return occurrence;
    }

    const schedule = await this.deps.schedules.findById({ tenantId, id: occurrence.scheduleId });
    if (!schedule) throw new AppError(ErrorCode.NOT_FOUND, 'Schedule não encontrado');

    await this.deps.occurrences.update(
      { tenantId, id: occurrenceId },
      { status: 'running', startedAt: new Date(), error: null },
    );

    const ctx = systemContext(tenantId, requestId);
    const started = Date.now();

    try {
      let output: Record<string, unknown>;
      let actionExecutionId: string | null = null;
      let waitForAutomation = false;

      switch (schedule.target) {
        case 'action': {
          const result = await this.runActionTarget(ctx, schedule);
          output = result.output;
          actionExecutionId = result.actionExecutionId;
          break;
        }
        case 'ai_agent': {
          output = await this.runAgentTarget(ctx, schedule, occurrenceId);
          break;
        }
        case 'automation': {
          const startedRun = await this.runAutomationTarget(ctx, schedule, occurrenceId);
          output = { runId: startedRun.id, status: startedRun.status };
          waitForAutomation = true;
          break;
        }
        default:
          throw new AppError(ErrorCode.VALIDATION_ERROR, 'Alvo de agendamento desconhecido.');
      }

      if (waitForAutomation) {
        logger.info({
          tenant_id: tenantId,
          operation: 'schedule_run',
          schedule_id: schedule.id,
          occurrence_id: occurrenceId,
          target: schedule.target,
          duration_ms: Date.now() - started,
          status: 202,
        });
        return this.deps.occurrences.findById({ tenantId, id: occurrenceId });
      }

      await this.deps.occurrences.update(
        { tenantId, id: occurrenceId },
        { status: 'completed', output, actionExecutionId, finishedAt: new Date() },
      );

      // Success counts towards the cap; disable when the budget is spent.
      const updated = await this.deps.schedules.incrementSuccess({
        tenantId,
        id: schedule.id,
        at: new Date(),
      });
      if (
        updated.repeatMode === 'count' &&
        updated.maxOccurrences !== null &&
        updated.successCount >= updated.maxOccurrences
      ) {
        await this.deps.schedules.setEnabled({ tenantId, id: schedule.id, enabled: false });
      }

      await this.deps.auditLogs.record(ctx, {
        action: AuditAction.SCHEDULE_OCCURRENCE_COMPLETED,
        entityType: 'schedule_occurrence',
        entityId: occurrenceId,
        actorType: 'system',
        metadata: { scheduleId: schedule.id, target: schedule.target, actionExecutionId },
      });

      logger.info({
        tenant_id: tenantId,
        operation: 'schedule_run',
        schedule_id: schedule.id,
        occurrence_id: occurrenceId,
        target: schedule.target,
        duration_ms: Date.now() - started,
        status: 200,
      });
    } catch (error) {
      const message =
        error instanceof AppError
          ? `${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : 'Erro interno ao executar o agendamento';

      await this.deps.occurrences.update(
        { tenantId, id: occurrenceId },
        { status: 'failed', error: message, finishedAt: new Date() },
      );

      await this.deps.auditLogs.record(ctx, {
        action: AuditAction.SCHEDULE_OCCURRENCE_FAILED,
        entityType: 'schedule_occurrence',
        entityId: occurrenceId,
        actorType: 'system',
        metadata: { scheduleId: schedule.id, target: schedule.target, error: message },
      });

      logger.error({
        tenant_id: tenantId,
        operation: 'schedule_run',
        schedule_id: schedule.id,
        occurrence_id: occurrenceId,
        target: schedule.target,
        duration_ms: Date.now() - started,
        status: 500,
        error: message,
      });
    }

    return this.deps.occurrences.findById({ tenantId, id: occurrenceId });
  }

  private async runAutomationTarget(
    ctx: RequestContext,
    schedule: {
      id: string;
      effectMode: string;
      automationId: string | null;
      automationParams: unknown;
    },
    occurrenceId: string,
  ): Promise<{ id: string; status: string }> {
    if (!this.deps.automationRunner) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Executor de automações não está configurado.');
    }
    if (!schedule.automationId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Agendamento de automação exige automationId.');
    }
    const params =
      schedule.automationParams && typeof schedule.automationParams === 'object' && !Array.isArray(schedule.automationParams)
        ? (schedule.automationParams as Record<string, unknown>)
        : {};
    const startedRun = await this.deps.automationRunner.start({
      ctx,
      scheduleId: schedule.id,
      occurrenceId,
      automationId: schedule.automationId,
      params,
      effectMode: schedule.effectMode === 'auto_execute' ? 'auto_execute' : 'propose',
    });
    await this.deps.occurrences.update(
      { tenantId: ctx.tenantId as string, id: occurrenceId },
      {
        status: 'running',
        automationRunId: startedRun.id,
        output: { runId: startedRun.id, status: startedRun.status },
      },
    );
    return startedRun;
  }

  private async runActionTarget(
    ctx: RequestContext,
    schedule: {
      id: string;
      target: string;
      effectMode: string;
      actionType: ActionType | null;
      actionInput: unknown;
    },
  ): Promise<{ output: Record<string, unknown>; actionExecutionId: string }> {
    if (!schedule.actionType) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Agendamento de ação sem actionType.');
    }
    const forceExecute = schedule.effectMode === 'auto_execute';
    const execution = await this.deps.engine.propose(
      ctx,
      {
        actionType: schedule.actionType,
        input: (schedule.actionInput ?? {}) as unknown,
        reason: `Agendamento ${schedule.id}`,
        // Idempotent per occurrence run: the occurrence period already guards
        // duplicates, but this also dedupes at the execution layer.
        idempotencyKey: `schedule:${schedule.id}:${ctx.requestId}`,
      },
      { origin: 'schedule', forceExecute },
    );

    // The engine never throws on executor failure — it records `failed`. For an
    // auto_execute schedule the occurrence must reflect that failure so it does
    // NOT count towards the success cap (spec §5.1).
    if (forceExecute && execution.status === 'failed') {
      throw new AppError(
        ErrorCode.ACTION_ERROR,
        execution.error ?? `Ação '${schedule.actionType}' falhou na execução agendada.`,
      );
    }

    return {
      output: {
        actionType: schedule.actionType,
        status: execution.status,
        requiresApproval: !forceExecute && execution.status === 'awaiting_approval',
      },
      actionExecutionId: execution.id,
    };
  }

  private async runAgentTarget(
    ctx: RequestContext,
    schedule: {
      id: string;
      effectMode: string;
      aiConfig: unknown;
    },
    occurrenceId: string,
  ): Promise<Record<string, unknown>> {
    if (!this.deps.agentRunner) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Runner do agente não configurado neste ambiente.',
      );
    }
    const aiConfig = (schedule.aiConfig ?? null) as {
      systemPrompt?: string;
      instruction: string;
      tools?: string[];
      skillIds?: string[];
    } | null;
    if (!aiConfig || !aiConfig.instruction) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Agendamento do agente sem aiConfig.instruction.');
    }
    return this.deps.agentRunner.run({
      ctx,
      scheduleId: schedule.id,
      occurrenceId,
      effectMode: schedule.effectMode === 'auto_execute' ? 'auto_execute' : 'propose',
      aiConfig,
    });
  }
}
