import type {
  ActionExecutionRepository,
  ActionRepository,
  ActionType,
  ApprovalRepository,
  CreateEpisodeInput,
} from '@tactia/database';
import {
  AuditAction,
  entityFromActionInput,
  formatEpisodeText,
  type AuditLogService,
} from '@tactia/domain';
import { assertOwnerOrAdmin, assertRole } from '@tactia/domain';
import { AppError, ErrorCode, createId, isAppError, logger, type RequestContext } from '@tactia/shared';
import type { ActionRegistry } from './action-registry';
import { InlineJobQueue } from './job-queue';
import type { ExecutionOrigin, JobQueue, ProposeActionInput } from './types';

export type EpisodeSink = {
  record(input: CreateEpisodeInput): Promise<void>;
};

export type ExecutionEngineDeps = {
  actions: ActionRepository;
  executions: ActionExecutionRepository;
  approvals: ApprovalRepository;
  registry: ActionRegistry;
  auditLogs: AuditLogService;
  /** Defaults to `InlineJobQueue` (spec §46). */
  queue?: JobQueue;
  /** Optional episodic memory writer (Etapa 15). Absent = no-op. */
  episodes?: EpisodeSink;
};

/** Statuses from which an execution may still transition to `running`. */
const RUNNABLE = new Set(['pending', 'approved']);
const CANCELLABLE = new Set(['pending', 'awaiting_approval', 'approved']);

/**
 * Execution Engine (spec §44–45).
 *
 * Lifecycle:
 *   propose → validate schema → (requires approval? → Approval pendente)
 *           → run (background/inline) → output ou erro registrados
 *
 * Nothing here trusts free text: the action type must exist in the registry and
 * the input must satisfy its Zod schema before an execution row is created.
 */
export class ExecutionEngine {
  private readonly queue: JobQueue;

  constructor(private readonly deps: ExecutionEngineDeps) {
    this.queue = deps.queue ?? new InlineJobQueue();
  }

  /**
   * Proposes an action. Returns the execution with its action and approvals.
   *
   * - `origin: 'ai'` always goes through approval, no matter the action config
   *   (an LLM never triggers a side effect on its own — spec §44).
   * - A repeated `idempotencyKey` returns the original execution (spec §52).
   */
  async propose(
    ctx: RequestContext,
    raw: ProposeActionInput,
    options: { origin?: ExecutionOrigin; forceExecute?: boolean } = {},
  ) {
    const origin = options.origin ?? 'user';
    // `schedule` is a server-only origin: the scheduler tick enqueues it and
    // authorization already happened when the owner/admin created the schedule.
    // There is no user/operator principal at run time, so the user-facing role
    // gate does not apply; we only require a tenant scope.
    if (origin === 'schedule') {
      if (!ctx.tenantId) {
        throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'An active tenant is required');
      }
    } else {
      assertRole(ctx, 'member');
    }
    // Both branches guarantee a tenant scope; narrow for the rest of the method.
    const tenantId = ctx.tenantId;
    if (!tenantId) {
      throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'An active tenant is required');
    }
    const scoped: RequestContext & { tenantId: string } = { ...ctx, tenantId };

    if (raw.idempotencyKey) {
      const existing = await this.deps.executions.findByIdempotencyKey({
        tenantId,
        key: raw.idempotencyKey,
      });
      if (existing) {
        logger.info({
          request_id: ctx.requestId,
          tenant_id: tenantId,
          operation: 'action_propose_idempotent_hit',
          execution_id: existing.id,
        });
        return existing;
      }
    }

    const action = await this.resolveAction(scoped, raw);
    if (!action.enabled) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Ação '${action.type}' está desativada`);
    }

    // Schema validation before anything is persisted (spec §45)
    const input = this.deps.registry.validate(action.type, raw.input);

    // `ai_direct` is the explicit "send now" rail for send_email: it skips
    // approval by design (relaxes spec §44 only for this origin + action type).
    // `forceExecute` is the scheduler's `auto_execute` rail: the owner configured
    // the schedule to run without a human in the loop, so approval is skipped.
    // Every other origin keeps the previous guardrail.
    const requiresApproval =
      origin === 'ai_direct' || options.forceExecute
        ? false
        : action.requiresApproval || origin === 'ai' || origin === 'mcp';

    let execution;
    try {
      execution = await this.deps.executions.create({
        tenantId,
        actionId: action.id,
        requestedBy: ctx.userId,
        origin,
        status: requiresApproval ? 'awaiting_approval' : 'pending',
        input,
        idempotencyKey: raw.idempotencyKey ?? null,
      });
    } catch (error) {
      // Concurrent request with the same Idempotency-Key won the race.
      if (raw.idempotencyKey && isUniqueViolation(error)) {
        const existing = await this.deps.executions.findByIdempotencyKey({
          tenantId,
          key: raw.idempotencyKey,
        });
        if (existing) return existing;
      }
      throw error;
    }

    if (requiresApproval) {
      await this.deps.approvals.create({
        tenantId,
        actionExecutionId: execution.id,
        requestedBy: ctx.userId,
        reason: raw.reason ?? null,
      });
    }

    await this.deps.auditLogs.record(ctx, {
      action: AuditAction.ACTION_PROPOSED,
      entityType: 'action_execution',
      entityId: execution.id,
      actorType: origin === 'ai' || origin === 'ai_direct' ? 'ai' : origin === 'mcp' ? 'mcp' : 'user',
      metadata: {
        actionType: action.type,
        origin,
        requiresApproval,
        ...(raw.reason ? { reason: raw.reason } : {}),
      },
    });

    if (!requiresApproval) {
      await this.enqueue(scoped, execution.id);
    }

    return this.requireExecution(scoped, execution.id);
  }

  /**
   * Entry point used by the AI orchestrator. Never executes: the proposal is
   * always parked in `awaiting_approval` for a human (spec §44).
   */
  async proposeFromAi(
    ctx: RequestContext,
    input: {
      actionType: string;
      input: unknown;
      reason?: string | null;
      idempotencyKey?: string | null;
    },
  ) {
    return this.proposeFromOrigin(ctx, input, 'ai');
  }

  /**
   * Entry point used by the MCP adapter. Same motor as AI: never executes,
   * always parked in `awaiting_approval` (Onda 4).
   */
  async proposeFromMcp(
    ctx: RequestContext,
    input: {
      actionType: string;
      input: unknown;
      reason?: string | null;
      idempotencyKey?: string | null;
    },
  ) {
    return this.proposeFromOrigin(ctx, input, 'mcp');
  }

  /**
   * Direct e-mail send requested by the user through the chat assistant. Unlike
   * `proposeFromAi`, this executes immediately (no human approval) — it is the
   * only rail that lets the LLM cause a side effect on its own, and it is
   * deliberately restricted to `send_email` (origin `ai_direct`).
   */
  async sendEmailFromAi(
    ctx: RequestContext,
    input: {
      actionType?: string;
      input: unknown;
      reason?: string | null;
      idempotencyKey?: string | null;
    },
  ) {
    const type = (input.actionType ?? 'send_email') as ActionType;
    if (type !== 'send_email') {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Envio direto pela IA só é permitido para 'send_email' (recebido: '${type}').`,
      );
    }
    if (!this.deps.registry.has(type)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Ação '${type}' não é suportada. Disponíveis: ${this.deps.registry.types().join(', ')}.`,
      );
    }

    const execution = await this.propose(
      ctx,
      {
        actionType: type,
        input: input.input,
        reason: input.reason ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
      { origin: 'ai_direct' },
    );

    return {
      id: execution.id,
      actionType: type,
      status: execution.status,
      requiresApproval: false,
      output: (execution.output ?? null) as Record<string, unknown> | null,
      error: execution.error ?? null,
    };
  }

  private async proposeFromOrigin(
    ctx: RequestContext,
    input: {
      actionType: string;
      input: unknown;
      reason?: string | null;
      idempotencyKey?: string | null;
    },
    origin: 'ai' | 'mcp',
  ) {
    const type = input.actionType as ActionType;
    if (!this.deps.registry.has(type)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Ação '${input.actionType}' não é suportada. Disponíveis: ${this.deps.registry.types().join(', ')}.`,
      );
    }

    const execution = await this.propose(
      ctx,
      {
        actionType: type,
        input: input.input,
        reason: input.reason ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
      { origin },
    );

    return {
      id: execution.id,
      actionType: type,
      status: execution.status,
      requiresApproval: true,
      approvalId: execution.approvals.find((approval) => approval.status === 'pending')?.id ?? null,
    };
  }

  /** Approves a pending approval and runs the execution. */
  async approve(ctx: RequestContext, approvalId: string, reason?: string | null) {
    assertOwnerOrAdmin(ctx);

    const approval = await this.deps.approvals.findById({ tenantId: ctx.tenantId, id: approvalId });
    if (!approval) throw new AppError(ErrorCode.NOT_FOUND, 'Approval not found');
    if (approval.status !== 'pending') {
      throw new AppError(ErrorCode.CONFLICT, `Approval já está ${approval.status}`);
    }

    await this.deps.approvals.resolve(
      { tenantId: ctx.tenantId, id: approvalId },
      {
        status: 'approved',
        approvedBy: ctx.userId,
        ...(reason === undefined ? {} : { reason }),
      },
    );
    await this.deps.executions.update(
      { tenantId: ctx.tenantId, id: approval.actionExecutionId },
      { status: 'approved' },
    );

    await this.deps.auditLogs.record(ctx, {
      action: AuditAction.ACTION_APPROVED,
      entityType: 'action_execution',
      entityId: approval.actionExecutionId,
      metadata: { approvalId, actionType: approval.actionExecution.action.type },
    });

    await this.recordEpisode({
      tenantId: ctx.tenantId,
      execution: approval.actionExecution,
      kind: 'decision',
      outcome: 'approved',
      approvalId,
      reason: approval.reason,
    });

    await this.enqueue(ctx, approval.actionExecutionId);
    return this.requireExecution(ctx, approval.actionExecutionId);
  }

  /** Rejects a pending approval — the execution is cancelled, never run. */
  async reject(ctx: RequestContext, approvalId: string, reason?: string | null) {
    assertOwnerOrAdmin(ctx);

    const approval = await this.deps.approvals.findById({ tenantId: ctx.tenantId, id: approvalId });
    if (!approval) throw new AppError(ErrorCode.NOT_FOUND, 'Approval not found');
    if (approval.status !== 'pending') {
      throw new AppError(ErrorCode.CONFLICT, `Approval já está ${approval.status}`);
    }

    await this.deps.approvals.resolve(
      { tenantId: ctx.tenantId, id: approvalId },
      {
        status: 'rejected',
        approvedBy: ctx.userId,
        ...(reason === undefined ? {} : { reason }),
      },
    );
    await this.deps.executions.update(
      { tenantId: ctx.tenantId, id: approval.actionExecutionId },
      { status: 'cancelled', finishedAt: new Date() },
    );

    await this.deps.auditLogs.record(ctx, {
      action: AuditAction.ACTION_REJECTED,
      entityType: 'action_execution',
      entityId: approval.actionExecutionId,
      metadata: { approvalId, ...(reason ? { reason } : {}) },
    });

    await this.recordEpisode({
      tenantId: ctx.tenantId,
      execution: approval.actionExecution,
      kind: 'decision',
      outcome: 'rejected',
      approvalId,
      reason: approval.reason,
    });

    return this.requireExecution(ctx, approval.actionExecutionId);
  }

  /** Cancels an execution that has not run yet. */
  async cancel(ctx: RequestContext, executionId: string, reason?: string | null) {
    assertRole(ctx, 'member');
    const execution = await this.requireExecution(ctx, executionId);

    if (!CANCELLABLE.has(execution.status)) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Execução com status '${execution.status}' não pode ser cancelada`,
      );
    }

    const pending = await this.deps.approvals.findPendingByExecution({
      tenantId: ctx.tenantId,
      actionExecutionId: executionId,
    });
    if (pending) {
      await this.deps.approvals.resolve(
        { tenantId: ctx.tenantId, id: pending.id },
        { status: 'rejected', approvedBy: ctx.userId, reason: reason ?? 'Cancelada pelo autor' },
      );
    }

    await this.deps.executions.update(
      { tenantId: ctx.tenantId, id: executionId },
      { status: 'cancelled', finishedAt: new Date() },
    );

    await this.deps.auditLogs.record(ctx, {
      action: AuditAction.ACTION_CANCELLED,
      entityType: 'action_execution',
      entityId: executionId,
      metadata: reason ? { reason } : undefined,
    });

    await this.recordEpisode({
      tenantId: ctx.tenantId,
      execution,
      kind: 'decision',
      outcome: 'cancelled',
      approvalId: pending?.id ?? null,
      reason: reason ?? pending?.reason ?? null,
    });

    return this.requireExecution(ctx, executionId);
  }

  /**
   * Runs an execution. Never throws for executor failures: the failure is the
   * record (`status: failed` + `error`), which is what the spec asks for.
   */
  async run(tenantId: string, executionId: string, requestId = createId()) {
    const execution = await this.deps.executions.findById({ tenantId, id: executionId });
    if (!execution) throw new AppError(ErrorCode.NOT_FOUND, 'ActionExecution not found');

    if (!RUNNABLE.has(execution.status)) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Execução com status '${execution.status}' não pode ser executada`,
      );
    }

    await this.deps.executions.update(
      { tenantId, id: executionId },
      { status: 'running', startedAt: new Date(), error: null },
    );

    const started = Date.now();

    try {
      const definition = this.deps.registry.get(execution.action.type);
      // Defense in depth: revalidate the stored input at execution time.
      const input = this.deps.registry.validate(execution.action.type, execution.input);

      const output = await definition.execute(
        {
          tenantId,
          requestedBy: execution.requestedBy,
          requestId,
          executionId,
          configuration: (execution.action.configuration ?? {}) as Record<string, unknown>,
        },
        input,
      );

      await this.deps.executions.update(
        { tenantId, id: executionId },
        { status: 'completed', output, finishedAt: new Date() },
      );

      logger.info({
        request_id: requestId,
        tenant_id: tenantId,
        operation: `action:${execution.action.type}`,
        duration_ms: Date.now() - started,
        status: 200,
        execution_id: executionId,
      });

      await this.deps.auditLogs.record(
        { tenantId, userId: execution.requestedBy },
        {
          action:
            execution.origin === 'ai_direct'
              ? AuditAction.ACTION_EXECUTED_DIRECT
              : AuditAction.ACTION_EXECUTED,
          entityType: 'action_execution',
          entityId: executionId,
          actorType: execution.origin === 'ai_direct' ? 'ai' : 'system',
          metadata: { actionType: execution.action.type, origin: execution.origin, output },
        },
      );

      await this.recordEpisode({
        tenantId,
        execution,
        kind: 'action_outcome',
        outcome: 'executed',
        reason: execution.approvals[0]?.reason ?? null,
      });
    } catch (error) {
      const message = isAppError(error)
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'Erro interno ao executar a ação';

      await this.deps.executions.update(
        { tenantId, id: executionId },
        { status: 'failed', error: message, finishedAt: new Date() },
      );

      logger.error({
        request_id: requestId,
        tenant_id: tenantId,
        operation: `action:${execution.action.type}`,
        duration_ms: Date.now() - started,
        status: isAppError(error) ? error.statusCode : 500,
        error: isAppError(error) ? error.code : ErrorCode.ACTION_ERROR,
        execution_id: executionId,
      });

      await this.deps.auditLogs.record(
        { tenantId, userId: execution.requestedBy },
        {
          action: AuditAction.ACTION_FAILED,
          entityType: 'action_execution',
          entityId: executionId,
          actorType: 'system',
          metadata: { actionType: execution.action.type, error: message },
        },
      );

      await this.recordEpisode({
        tenantId,
        execution,
        kind: 'action_outcome',
        outcome: 'failed',
        reason: execution.approvals[0]?.reason ?? null,
      });
    }

    return this.deps.executions.findById({ tenantId, id: executionId });
  }

  /**
   * Returns the tenant's action definition, provisioning it from the registry
   * defaults on first use so the AI/API never fails for a missing catalog row.
   */
  async ensureAction(ctx: RequestContext, type: ActionType) {
    // Tenant scope is enough here: this only provisions a catalog default and
    // runs after authorization (user/operator at propose time, or the trusted
    // scheduler for `origin: schedule`). A missing tenant is still rejected.
    if (!ctx.tenantId) {
      throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'An active tenant is required');
    }
    const existing = await this.deps.actions.findByType({ tenantId: ctx.tenantId, type });
    if (existing) return existing;

    const definition = this.deps.registry.get(type);
    const action = await this.deps.actions.create({
      tenantId: ctx.tenantId,
      type,
      name: definition.name,
      description: definition.description,
      configuration: {},
      requiresApproval: definition.defaultRequiresApproval,
    });

    await this.deps.auditLogs.record(ctx, {
      action: AuditAction.ACTION_CREATED,
      entityType: 'action',
      entityId: action.id,
      actorType: 'system',
      metadata: { type, provisioned: 'default' },
    });

    return action;
  }

  private async recordEpisode(input: {
    tenantId: string;
    execution: {
      id: string;
      origin: string;
      input: unknown;
      action: { type: string };
    };
    kind: 'decision' | 'action_outcome';
    outcome: CreateEpisodeInput['outcome'];
    approvalId?: string | null;
    reason?: string | null;
  }) {
    if (!this.deps.episodes) return;
    const entity = entityFromActionInput(input.execution.input);
    try {
      await this.deps.episodes.record({
        tenantId: input.tenantId,
        kind: input.kind,
        outcome: input.outcome,
        text: formatEpisodeText({
          actionType: input.execution.action.type,
          origin: input.execution.origin,
          outcome: input.outcome,
          reason: input.reason,
          input: input.execution.input,
        }),
        actionExecutionId: input.execution.id,
        approvalId: input.approvalId ?? null,
        entityType: entity.entityType,
        entityId: entity.entityId,
        occurredAt: new Date(),
      });
    } catch (error) {
      logger.warn(
        {
          tenant_id: input.tenantId,
          execution_id: input.execution.id,
          operation: 'episode_sink',
          err: error instanceof Error ? error.message : String(error),
        },
        'episode sink failed',
      );
    }
  }

  // -------------------------------------------------------------------------

  private async resolveAction(ctx: RequestContext & { tenantId: string }, raw: ProposeActionInput) {
    if (raw.actionId) {
      const action = await this.deps.actions.findById({ tenantId: ctx.tenantId, id: raw.actionId });
      if (!action) throw new AppError(ErrorCode.NOT_FOUND, 'Action not found');
      return action;
    }
    if (raw.actionType) {
      return this.ensureAction(ctx, raw.actionType);
    }
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Informe actionId ou actionType');
  }

  private async enqueue(ctx: RequestContext & { tenantId: string }, executionId: string) {
    const { tenantId, requestId } = ctx;
    await this.queue.enqueue({
      tenantId,
      executionId,
      run: () => this.run(tenantId, executionId, requestId).then(() => undefined),
    });
  }

  private async requireExecution(ctx: RequestContext & { tenantId: string }, id: string) {
    const execution = await this.deps.executions.findById({ tenantId: ctx.tenantId, id });
    if (!execution) throw new AppError(ErrorCode.NOT_FOUND, 'ActionExecution not found');
    return execution;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}
