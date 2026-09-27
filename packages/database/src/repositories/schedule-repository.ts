import { createId } from '@tactia/shared';
import type {
  ActionType,
  PrismaClient,
  ScheduleEffectMode,
  ScheduleFrequency,
  ScheduleRepeatMode,
  ScheduleTarget,
} from '../client';
import { asJson, asNullableJson } from '../json';

export type CreateScheduleInput = {
  tenantId: string;
  name: string;
  description?: string | null;
  enabled?: boolean;
  target: ScheduleTarget;
  effectMode?: ScheduleEffectMode;
  frequency: ScheduleFrequency;
  recurrenceConfig?: Record<string, unknown>;
  cronExpression?: string | null;
  timezone?: string | null;
  repeatMode?: ScheduleRepeatMode;
  maxOccurrences?: number | null;
  aiConfig?: Record<string, unknown> | null;
  actionType?: ActionType | null;
  actionInput?: Record<string, unknown> | null;
  createdBy?: string | null;
};

export type UpdateScheduleInput = {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  target?: ScheduleTarget;
  effectMode?: ScheduleEffectMode;
  frequency?: ScheduleFrequency;
  recurrenceConfig?: Record<string, unknown>;
  cronExpression?: string | null;
  timezone?: string | null;
  repeatMode?: ScheduleRepeatMode;
  maxOccurrences?: number | null;
  aiConfig?: Record<string, unknown> | null;
  actionType?: ActionType | null;
  actionInput?: Record<string, unknown> | null;
  successCount?: number;
  lastRunAt?: Date | null;
};

export class ScheduleRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateScheduleInput) {
    return this.db.schedule.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        name: input.name,
        description: input.description ?? null,
        enabled: input.enabled ?? true,
        target: input.target,
        effectMode: input.effectMode ?? 'propose',
        frequency: input.frequency,
        recurrenceConfig: asJson(input.recurrenceConfig ?? {}) ?? {},
        cronExpression: input.cronExpression ?? null,
        timezone: input.timezone ?? null,
        repeatMode: input.repeatMode ?? 'infinite',
        maxOccurrences: input.maxOccurrences ?? null,
        aiConfig: asNullableJson(input.aiConfig),
        actionType: input.actionType ?? null,
        actionInput: asNullableJson(input.actionInput),
        createdBy: input.createdBy ?? null,
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.schedule.findFirst({ where: { id, tenantId } });
  }

  async list({
    tenantId,
    enabled,
    skip,
    take,
  }: {
    tenantId: string;
    enabled?: boolean;
    skip: number;
    take: number;
  }) {
    const where = {
      tenantId,
      ...(enabled === undefined ? {} : { enabled }),
    };
    const [items, total] = await Promise.all([
      this.db.schedule.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.schedule.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Enabled schedules that can still fire automatically: excludes `manual`
   * (which only fires on demand). The success cap for `repeat_mode = count` is
   * enforced by the service (it needs the same logic as the runner), so this
   * only narrows by the cheap indexed predicates.
   */
  async listActiveForSchedule() {
    return this.db.schedule.findMany({
      where: {
        enabled: true,
        frequency: { not: 'manual' },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update({ tenantId, id }: { tenantId: string; id: string }, input: UpdateScheduleInput) {
    return this.db.schedule.update({
      where: { id, tenantId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.target === undefined ? {} : { target: input.target }),
        ...(input.effectMode === undefined ? {} : { effectMode: input.effectMode }),
        ...(input.frequency === undefined ? {} : { frequency: input.frequency }),
        ...(input.recurrenceConfig === undefined
          ? {}
          : { recurrenceConfig: asJson(input.recurrenceConfig) ?? {} }),
        ...(input.cronExpression === undefined ? {} : { cronExpression: input.cronExpression }),
        ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
        ...(input.repeatMode === undefined ? {} : { repeatMode: input.repeatMode }),
        ...(input.maxOccurrences === undefined ? {} : { maxOccurrences: input.maxOccurrences }),
        ...(input.aiConfig === undefined ? {} : { aiConfig: asNullableJson(input.aiConfig) }),
        ...(input.actionType === undefined ? {} : { actionType: input.actionType }),
        ...(input.actionInput === undefined ? {} : { actionInput: asNullableJson(input.actionInput) }),
        ...(input.successCount === undefined ? {} : { successCount: input.successCount }),
        ...(input.lastRunAt === undefined ? {} : { lastRunAt: input.lastRunAt }),
      },
    });
  }

  /** Atomically bumps successCount and records the run time. */
  async incrementSuccess({ tenantId, id, at }: { tenantId: string; id: string; at: Date }) {
    return this.db.schedule.update({
      where: { id, tenantId },
      data: { successCount: { increment: 1 }, lastRunAt: at },
    });
  }

  async setEnabled({ tenantId, id, enabled }: { tenantId: string; id: string; enabled: boolean }) {
    return this.db.schedule.update({ where: { id, tenantId }, data: { enabled } });
  }

  async delete({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.schedule.deleteMany({ where: { id, tenantId } });
  }
}
