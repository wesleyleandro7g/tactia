import { createId } from '@tactia/shared';
import type { PrismaClient, ImportStatus } from '../client';

export type CreateImportInput = {
  tenantId: string;
  dataSourceId: string;
  syncJobId?: string | null;
  entityType: string;
  totalRecords?: number;
  idempotencyKey?: string | null;
};

export class ImportRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateImportInput) {
    const data = {
      id: createId(),
      tenantId: input.tenantId,
      dataSourceId: input.dataSourceId,
      syncJobId: input.syncJobId ?? null,
      entityType: input.entityType,
      totalRecords: input.totalRecords ?? 0,
      idempotencyKey: input.idempotencyKey ?? null,
    };
    if (input.idempotencyKey) {
      return this.db.import.upsert({
        where: { idempotencyKey: input.idempotencyKey },
        create: data,
        update: { totalRecords: data.totalRecords, syncJobId: data.syncJobId, status: 'pending' },
      });
    }
    return this.db.import.create({ data });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.import.findFirst({ where: { id, tenantId } });
  }

  async findByIdempotencyKey({ tenantId, key }: { tenantId: string; key: string }) {
    return this.db.import.findFirst({ where: { tenantId, idempotencyKey: key } });
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
      this.db.import.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.import.count({ where }),
    ]);
    return { items, total };
  }

  async updateStatus({ id, status }: { id: string; status: ImportStatus }) {
    return this.db.import.update({ where: { id }, data: { status } });
  }

  async updateCounters({
    id,
    processedRecords,
    failedRecords,
    status,
  }: {
    id: string;
    processedRecords: number;
    failedRecords: number;
    status?: ImportStatus;
  }) {
    return this.db.import.update({
      where: { id },
      data: { processedRecords, failedRecords, ...(status ? { status } : {}) },
    });
  }
}
