import { createId } from '@tactia/shared';
import type { PrismaClient, SyncJobMode, SyncJobStatus, SyncJobTrigger } from '../client';
import { asNullableJson } from '../json';

export type CreateSyncJobInput = {
  tenantId: string;
  dataSourceId: string;
  status?: SyncJobStatus;
  trigger?: SyncJobTrigger;
  mode?: SyncJobMode;
  idempotencyKey?: string | null;
  configSnapshot?: Record<string, unknown> | null;
};

export class SyncJobRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateSyncJobInput) {
    return this.db.syncJob.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId,
        status: input.status ?? 'pending',
        trigger: input.trigger ?? 'manual',
        mode: input.mode ?? 'full',
        idempotencyKey: input.idempotencyKey ?? null,
        configSnapshot: input.configSnapshot === undefined ? undefined : asNullableJson(input.configSnapshot),
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.syncJob.findFirst({ where: { id, tenantId } });
  }

  async list({
    tenantId,
    dataSourceId,
    statuses,
    skip,
    take,
  }: {
    tenantId: string;
    dataSourceId?: string;
    /** Optional status filter; omitted or empty means any status. */
    statuses?: SyncJobStatus[];
    skip: number;
    take: number;
  }) {
    const where = {
      tenantId,
      ...(dataSourceId ? { dataSourceId } : {}),
      ...(statuses && statuses.length > 0 ? { status: { in: statuses } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.syncJob.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.syncJob.count({ where }),
    ]);
    return { items, total };
  }

  async updateStatus({
    id,
    status,
    startedAt,
    finishedAt,
    error,
  }: {
    id: string;
    status: SyncJobStatus;
    startedAt?: Date;
    finishedAt?: Date;
    error?: string | null;
  }) {
    return this.db.syncJob.update({
      where: { id },
      data: { status, startedAt, finishedAt, error },
    });
  }

  async updateCounters({
    id,
    recordsRead,
    recordsCreated,
    recordsUpdated,
    recordsFailed,
  }: {
    id: string;
    recordsRead: number;
    recordsCreated: number;
    recordsUpdated: number;
    recordsFailed: number;
  }) {
    return this.db.syncJob.update({
      where: { id },
      data: { recordsRead, recordsCreated, recordsUpdated, recordsFailed },
    });
  }

  async findActiveByDataSource({ tenantId, dataSourceId }: { tenantId: string; dataSourceId: string }) {
    return this.db.syncJob.findFirst({
      where: { tenantId, dataSourceId, status: { in: ['pending', 'running'] } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByIdempotencyKey({ tenantId, key }: { tenantId: string; key: string }) {
    return this.db.syncJob.findFirst({ where: { tenantId, idempotencyKey: key } });
  }

  async createExclusive(input: CreateSyncJobInput): Promise<{ job: Awaited<ReturnType<SyncJobRepository['create']>>; created: boolean }> {
    if (input.idempotencyKey) {
      const idempotent = await this.findByIdempotencyKey({ tenantId: input.tenantId, key: input.idempotencyKey });
      if (idempotent) return { job: idempotent, created: false };
    }
    const active = await this.findActiveByDataSource({ tenantId: input.tenantId, dataSourceId: input.dataSourceId });
    if (active) return { job: active, created: false };
    try {
      return { job: await this.create(input), created: true };
    } catch (error) {
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      const idempotent = input.idempotencyKey
        ? await this.findByIdempotencyKey({ tenantId: input.tenantId, key: input.idempotencyKey })
        : null;
      const raced = idempotent ?? await this.findActiveByDataSource({ tenantId: input.tenantId, dataSourceId: input.dataSourceId });
      if (!raced) throw error;
      return { job: raced, created: false };
    }
  }
}
