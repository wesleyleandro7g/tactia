import { createId } from '@tactia/shared';
import type { PrismaClient, ScheduleOccurrenceStatus } from '../client';
import { asNullableJson } from '../json';

export type CreateScheduleOccurrenceInput = {
  tenantId: string;
  scheduleId: string;
  periodKey: string;
  status?: ScheduleOccurrenceStatus;
  origin?: string;
};

export type UpdateScheduleOccurrenceInput = {
  status?: ScheduleOccurrenceStatus;
  actionExecutionId?: string | null;
  automationRunId?: string | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

export class ScheduleOccurrenceRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateScheduleOccurrenceInput) {
    return this.db.scheduleOccurrence.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        scheduleId: input.scheduleId,
        periodKey: input.periodKey,
        status: input.status ?? 'pending',
        origin: input.origin ?? 'system',
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.scheduleOccurrence.findFirst({ where: { id, tenantId } });
  }

  async findByPeriod({
    tenantId,
    scheduleId,
    periodKey,
  }: {
    tenantId: string;
    scheduleId: string;
    periodKey: string;
  }) {
    return this.db.scheduleOccurrence.findFirst({ where: { tenantId, scheduleId, periodKey } });
  }

  async listBySchedule({
    tenantId,
    scheduleId,
    skip,
    take,
  }: {
    tenantId: string;
    scheduleId: string;
    skip: number;
    take: number;
  }) {
    const where = { tenantId, scheduleId };
    const [items, total] = await Promise.all([
      this.db.scheduleOccurrence.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.scheduleOccurrence.count({ where }),
    ]);
    return { items, total };
  }

  async update({ tenantId, id }: { tenantId: string; id: string }, input: UpdateScheduleOccurrenceInput) {
    return this.db.scheduleOccurrence.update({
      where: { id, tenantId },
      data: {
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.actionExecutionId === undefined ? {} : { actionExecutionId: input.actionExecutionId }),
        ...(input.automationRunId === undefined ? {} : { automationRunId: input.automationRunId }),
        ...(input.output === undefined ? {} : { output: asNullableJson(input.output) }),
        ...(input.error === undefined ? {} : { error: input.error }),
        ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
        ...(input.finishedAt === undefined ? {} : { finishedAt: input.finishedAt }),
      },
    });
  }

  /**
   * Creates one occurrence per (schedule, periodKey). A repeated period returns
   * the existing occurrence instead of a new one, so a retried tick never
   * repeats work already recorded for that period (spec resiliência §5.1).
   */
  async createExclusive(
    input: CreateScheduleOccurrenceInput,
  ): Promise<{ occurrence: Awaited<ReturnType<ScheduleOccurrenceRepository['create']>>; created: boolean }> {
    const existing = await this.findByPeriod({
      tenantId: input.tenantId,
      scheduleId: input.scheduleId,
      periodKey: input.periodKey,
    });
    if (existing) return { occurrence: existing, created: false };
    try {
      return { occurrence: await this.create(input), created: true };
    } catch (error) {
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      const raced = await this.findByPeriod({
        tenantId: input.tenantId,
        scheduleId: input.scheduleId,
        periodKey: input.periodKey,
      });
      if (!raced) throw error;
      return { occurrence: raced, created: false };
    }
  }

  /**
   * Reset (spec resiliência §5.2): removes the occurrence for a period so the
   * schedule may run it again. The only sanctioned way to repeat done work.
   */
  async deleteByPeriod({
    tenantId,
    scheduleId,
    periodKey,
  }: {
    tenantId: string;
    scheduleId: string;
    periodKey: string;
  }) {
    return this.db.scheduleOccurrence.deleteMany({ where: { tenantId, scheduleId, periodKey } });
  }

  async deleteById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.scheduleOccurrence.deleteMany({ where: { tenantId, id } });
  }
}
