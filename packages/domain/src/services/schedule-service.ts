import type {
  ActionType,
  ScheduleOccurrenceRepository,
  ScheduleRepository,
} from '@tactia/database';
import { AppError, ErrorCode, createId, logger, type RequestContext } from '@tactia/shared';
import { z } from 'zod';
import { assertOwnerOrAdmin, assertTenantContext } from '../authz';
import { AuditAction, type AuditLogService } from './audit-log-service';
import {
  computePeriodKey,
  isDue,
  isValidCronExpression,
  recurrenceConfigSchema,
  type ScheduleRecurrence,
} from './schedule-recurrence';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ACTION_TYPES = ['create_task', 'send_email', 'send_whatsapp', 'generate_report', 'browser_action'] as const;

const aiConfigSchema = z
  .object({
    systemPrompt: z.string().trim().max(8_000).optional(),
    instruction: z.string().trim().min(1).max(8_000),
    tools: z.array(z.string().trim().min(1)).optional(),
    skillIds: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

const baseScheduleShape = {
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullish(),
  enabled: z.boolean().optional(),
  target: z.enum(['ai_agent', 'action', 'automation']),
  effectMode: z.enum(['propose', 'auto_execute']).optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'custom', 'manual']),
  recurrenceConfig: recurrenceConfigSchema.optional(),
  cronExpression: z.string().trim().min(1).max(120).nullish(),
  timezone: z.string().trim().min(1).max(64).nullish(),
  repeatMode: z.enum(['infinite', 'count']).optional(),
  maxOccurrences: z.number().int().min(1).max(10_000).nullish(),
  aiConfig: aiConfigSchema.nullish(),
  actionType: z.enum(ACTION_TYPES).nullish(),
  actionInput: z.record(z.unknown()).nullish(),
  automationId: z.string().uuid().nullish(),
  automationParams: z.record(z.unknown()).nullish(),
};

/** Cross-field rules shared by create/update once the object is assembled. */
function assertCoherent(value: {
  target: 'ai_agent' | 'action' | 'automation';
  frequency: 'daily' | 'weekly' | 'monthly' | 'custom' | 'manual';
  recurrenceConfig?: z.infer<typeof recurrenceConfigSchema>;
  cronExpression?: string | null;
  repeatMode?: 'infinite' | 'count';
  maxOccurrences?: number | null;
  aiConfig?: z.infer<typeof aiConfigSchema> | null;
  actionType?: ActionType | null;
  automationId?: string | null;
}) {
  if (value.target === 'ai_agent' && !value.aiConfig) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Agendamentos do agente exigem aiConfig com instruction.');
  }
  if (value.target === 'action' && !value.actionType) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Agendamentos de ação exigem actionType.');
  }
  if (value.target === 'automation' && !value.automationId) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Agendamentos de automação exigem automationId.');
  }
  if (value.frequency === 'custom' && !value.cronExpression) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Frequência custom exige cronExpression.');
  }
  if (value.frequency === 'custom' && value.cronExpression && !isValidCronExpression(value.cronExpression)) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'cronExpression inválida. Use 5 campos (min hora dia-do-mês mês dia-da-semana), ex.: "*/5 * * * *".',
    );
  }
  if (value.frequency === 'weekly' && !(value.recurrenceConfig?.weekdays?.length)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Frequência semanal exige recurrenceConfig.weekdays.');
  }
  if (
    value.frequency === 'monthly' &&
    value.recurrenceConfig?.dayOfMonth === undefined &&
    value.recurrenceConfig?.nthBusinessDay === undefined
  ) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      'Frequência mensal exige recurrenceConfig.dayOfMonth ou nthBusinessDay.',
    );
  }
  if (value.repeatMode === 'count' && !value.maxOccurrences) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'repeatMode=count exige maxOccurrences >= 1.');
  }
}

export const createScheduleSchema = z.object(baseScheduleShape).strict();
export const updateScheduleSchema = z.object(baseScheduleShape).partial().strict();

export type CreateScheduleRequest = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleRequest = z.infer<typeof updateScheduleSchema>;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type ScheduleServiceDeps = {
  schedules: ScheduleRepository;
  occurrences: ScheduleOccurrenceRepository;
  auditLogs: AuditLogService;
  /** Resolves the tenant's default timezone when the schedule has none. */
  tenantTimezone: (tenantId: string) => Promise<string | null | undefined>;
  /** Enqueues a due occurrence for execution. Absent in read-only wiring. */
  enqueueRun?: (job: {
    tenantId: string;
    scheduleId: string;
    occurrenceId: string;
    periodKey: string;
  }) => Promise<void>;
};

const DEFAULT_TZ = 'America/Sao_Paulo';

export class ScheduleService {
  constructor(private readonly deps: ScheduleServiceDeps) {}

  async list(ctx: RequestContext, query: { enabled?: boolean; page?: number; pageSize?: number } = {}) {
    assertTenantContext(ctx);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, 200);
    return this.deps.schedules.list({
      tenantId: ctx.tenantId,
      ...(query.enabled === undefined ? {} : { enabled: query.enabled }),
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const schedule = await this.deps.schedules.findById({ tenantId: ctx.tenantId, id });
    if (!schedule) throw new AppError(ErrorCode.NOT_FOUND, 'Agendamento não encontrado');
    return schedule;
  }

  async listOccurrences(
    ctx: RequestContext,
    scheduleId: string,
    query: { page?: number; pageSize?: number } = {},
  ) {
    assertTenantContext(ctx);
    await this.get(ctx, scheduleId);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, 200);
    return this.deps.occurrences.listBySchedule({
      tenantId: ctx.tenantId,
      scheduleId,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  async create(ctx: RequestContext, raw: unknown, options: { actorType?: string } = {}) {
    assertOwnerOrAdmin(ctx);
    const input = createScheduleSchema.parse(raw);
    assertCoherent({ ...input, actionType: (input.actionType ?? null) as ActionType | null });

    const schedule = await this.deps.schedules.create({
      tenantId: ctx.tenantId,
      name: input.name,
      description: input.description ?? null,
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      target: input.target,
      ...(input.effectMode ? { effectMode: input.effectMode } : {}),
      frequency: input.frequency,
      recurrenceConfig: input.recurrenceConfig ?? {},
      cronExpression: input.cronExpression ?? null,
      timezone: input.timezone ?? null,
      ...(input.repeatMode ? { repeatMode: input.repeatMode } : {}),
      maxOccurrences: input.maxOccurrences ?? null,
      aiConfig: input.aiConfig ?? null,
      actionType: (input.actionType ?? null) as ActionType | null,
      actionInput: input.actionInput ?? null,
      automationId: input.automationId ?? null,
      automationParams: input.automationParams ?? null,
      createdBy: ctx.userId ?? null,
    });

    await this.deps.auditLogs.record(ctx, {
      action: AuditAction.SCHEDULE_CREATED,
      entityType: 'schedule',
      entityId: schedule.id,
      ...(options.actorType ? { actorType: options.actorType } : {}),
      metadata: { target: schedule.target, frequency: schedule.frequency, effectMode: schedule.effectMode },
    });
    return schedule;
  }

  async update(ctx: RequestContext, id: string, raw: unknown, options: { actorType?: string } = {}) {
    assertOwnerOrAdmin(ctx);
    const existing = await this.get(ctx, id);
    const patch = updateScheduleSchema.parse(raw);

    // Validate the merged shape so cross-field rules hold after the patch.
    const merged = {
      target: (patch.target ?? existing.target) as 'ai_agent' | 'action' | 'automation',
      frequency: (patch.frequency ?? existing.frequency) as CreateScheduleRequest['frequency'],
      recurrenceConfig: (patch.recurrenceConfig ??
        (existing.recurrenceConfig as z.infer<typeof recurrenceConfigSchema>)) || {},
      cronExpression: patch.cronExpression ?? existing.cronExpression,
      repeatMode: (patch.repeatMode ?? existing.repeatMode) as 'infinite' | 'count',
      maxOccurrences: patch.maxOccurrences ?? existing.maxOccurrences,
      aiConfig: (patch.aiConfig ?? existing.aiConfig) as z.infer<typeof aiConfigSchema> | null,
      actionType: (patch.actionType ?? existing.actionType) as ActionType | null,
      automationId: patch.automationId ?? existing.automationId,
    };
    assertCoherent(merged);

    const schedule = await this.deps.schedules.update(
      { tenantId: ctx.tenantId, id },
      {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
        ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
        ...(patch.target === undefined ? {} : { target: patch.target }),
        ...(patch.effectMode === undefined ? {} : { effectMode: patch.effectMode }),
        ...(patch.frequency === undefined ? {} : { frequency: patch.frequency }),
        ...(patch.recurrenceConfig === undefined ? {} : { recurrenceConfig: patch.recurrenceConfig }),
        ...(patch.cronExpression === undefined ? {} : { cronExpression: patch.cronExpression }),
        ...(patch.timezone === undefined ? {} : { timezone: patch.timezone }),
        ...(patch.repeatMode === undefined ? {} : { repeatMode: patch.repeatMode }),
        ...(patch.maxOccurrences === undefined ? {} : { maxOccurrences: patch.maxOccurrences }),
        ...(patch.aiConfig === undefined ? {} : { aiConfig: patch.aiConfig }),
        ...(patch.actionType === undefined ? {} : { actionType: (patch.actionType ?? null) as ActionType | null }),
        ...(patch.actionInput === undefined ? {} : { actionInput: patch.actionInput }),
        ...(patch.automationId === undefined ? {} : { automationId: patch.automationId }),
        ...(patch.automationParams === undefined ? {} : { automationParams: patch.automationParams }),
      },
    );

    await this.deps.auditLogs.record(ctx, {
      action: AuditAction.SCHEDULE_UPDATED,
      entityType: 'schedule',
      entityId: id,
      ...(options.actorType ? { actorType: options.actorType } : {}),
      metadata: { fields: Object.keys(patch) },
    });
    return schedule;
  }

  async setEnabled(ctx: RequestContext, id: string, enabled: boolean, options: { actorType?: string } = {}) {
    assertOwnerOrAdmin(ctx);
    await this.get(ctx, id);
    const schedule = await this.deps.schedules.setEnabled({ tenantId: ctx.tenantId, id, enabled });
    await this.deps.auditLogs.record(ctx, {
      action: enabled ? AuditAction.SCHEDULE_ENABLED : AuditAction.SCHEDULE_DISABLED,
      entityType: 'schedule',
      entityId: id,
      ...(options.actorType ? { actorType: options.actorType } : {}),
    });
    return schedule;
  }

  async delete(ctx: RequestContext, id: string, options: { actorType?: string } = {}) {
    assertOwnerOrAdmin(ctx);
    await this.get(ctx, id);
    await this.deps.schedules.delete({ tenantId: ctx.tenantId, id });
    await this.deps.auditLogs.record(ctx, {
      action: AuditAction.SCHEDULE_DELETED,
      entityType: 'schedule',
      entityId: id,
      ...(options.actorType ? { actorType: options.actorType } : {}),
    });
    return { deleted: true };
  }

  /**
   * Manual trigger (spec §4.5). Creates a one-off occurrence and enqueues it.
   * The period key is unique per trigger so it never collides with automatic
   * periods and can always fire on demand.
   */
  async triggerNow(
    ctx: RequestContext,
    id: string,
    options: { actorType?: string; now?: Date } = {},
  ) {
    assertOwnerOrAdmin(ctx);
    const schedule = await this.get(ctx, id);
    const now = options.now ?? new Date();
    const periodKey = `manual:${now.toISOString()}:${createId().slice(0, 8)}`;

    const { occurrence } = await this.deps.occurrences.createExclusive({
      tenantId: ctx.tenantId,
      scheduleId: schedule.id,
      periodKey,
      origin: ctx.userId ? 'user' : 'system',
    });

    await this.deps.auditLogs.record(ctx, {
      action: AuditAction.SCHEDULE_TRIGGERED,
      entityType: 'schedule',
      entityId: schedule.id,
      ...(options.actorType ? { actorType: options.actorType } : {}),
      metadata: { occurrenceId: occurrence.id, periodKey },
    });

    if (this.deps.enqueueRun) {
      await this.deps.enqueueRun({
        tenantId: ctx.tenantId,
        scheduleId: schedule.id,
        occurrenceId: occurrence.id,
        periodKey,
      });
    }
    return occurrence;
  }

  /**
   * Reset (spec §5.2): deletes the occurrence for a period so the schedule may
   * run it again. This is the only sanctioned way to repeat done work.
   */
  async resetOccurrence(
    ctx: RequestContext,
    id: string,
    periodKey: string,
    options: { actorType?: string } = {},
  ) {
    assertOwnerOrAdmin(ctx);
    await this.get(ctx, id);
    await this.deps.occurrences.deleteByPeriod({ tenantId: ctx.tenantId, scheduleId: id, periodKey });
    await this.deps.auditLogs.record(ctx, {
      action: AuditAction.SCHEDULE_RESET,
      entityType: 'schedule',
      entityId: id,
      ...(options.actorType ? { actorType: options.actorType } : {}),
      metadata: { periodKey },
    });
    return { reset: true, periodKey };
  }

  private async resolveTimezone(tenantId: string, scheduleTz: string | null): Promise<string> {
    if (scheduleTz) return scheduleTz;
    const tenantTz = await this.deps.tenantTimezone(tenantId);
    return tenantTz || DEFAULT_TZ;
  }

  private recurrenceOf(schedule: {
    frequency: ScheduleRecurrence['frequency'];
    recurrenceConfig: unknown;
    cronExpression: string | null;
  }, timezone: string): ScheduleRecurrence {
    return {
      frequency: schedule.frequency,
      recurrenceConfig: (schedule.recurrenceConfig ?? {}) as ScheduleRecurrence['recurrenceConfig'],
      cronExpression: schedule.cronExpression,
      timezone,
    };
  }

  /** Whether a count-capped schedule still has budget for another success. */
  private hasBudget(schedule: { repeatMode: string; maxOccurrences: number | null; successCount: number }): boolean {
    if (schedule.repeatMode !== 'count') return true;
    if (schedule.maxOccurrences === null) return true;
    return schedule.successCount < schedule.maxOccurrences;
  }

  /**
   * Scheduler tick entry point. For each enabled, non-manual schedule that is
   * due now and still has budget, creates an exclusive occurrence and enqueues
   * it. Idempotent per period via the occurrence store (spec §5.1).
   */
  async enqueueDueSchedules(now = new Date()): Promise<{ enqueued: number; evaluated: number }> {
    if (!this.deps.enqueueRun) return { enqueued: 0, evaluated: 0 };
    const schedules = await this.deps.schedules.listActiveForSchedule();
    let enqueued = 0;
    for (const schedule of schedules) {
      try {
        if (!this.hasBudget(schedule)) continue;
        const timezone = await this.resolveTimezone(schedule.tenantId, schedule.timezone);
        const recurrence = this.recurrenceOf(schedule, timezone);
        if (!isDue(recurrence, now)) continue;

        const periodKey = computePeriodKey(recurrence, now);
        const { occurrence, created } = await this.deps.occurrences.createExclusive({
          tenantId: schedule.tenantId,
          scheduleId: schedule.id,
          periodKey,
          origin: 'system',
        });
        if (!created) continue;

        await this.deps.enqueueRun({
          tenantId: schedule.tenantId,
          scheduleId: schedule.id,
          occurrenceId: occurrence.id,
          periodKey,
        });
        enqueued += 1;
      } catch (error) {
        logger.error({
          tenant_id: schedule.tenantId,
          schedule_id: schedule.id,
          operation: 'schedule_tick',
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { enqueued, evaluated: schedules.length };
  }
}
