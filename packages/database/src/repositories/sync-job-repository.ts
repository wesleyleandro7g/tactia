import { createId } from '@tactia/shared';
import type { PrismaClient, SyncJobStatus } from '../client';

export type CreateSyncJobInput = {
  tenantId: string;
  dataSourceId: string;
  status?: SyncJobStatus;
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
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.syncJob.findFirst({ where: { id, tenantId } });
  }

  async list({
    tenantId,
    dataSourceId,
    skip,
    take,
  }: {
    tenantId: string;
    dataSourceId?: string;
    skip: number;
    take: number;
  }) {
    const where = {
      tenantId,
      ...(dataSourceId ? { dataSourceId } : {}),
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
}
