import { createId } from '@tactia/shared';
import type { PrismaClient, Prisma } from '../client';
import { asJson } from '../json';

export type UpsertRawRecordInput = {
  tenantId: string;
  dataSourceId: string;
  syncJobId?: string | null;
  externalId?: string | null;
  entityType: string;
  payload: Record<string, unknown>;
  checksum: string;
};

export class RawRecordRepository {
  constructor(private readonly db: PrismaClient) {}

  async upsertByKey(input: UpsertRawRecordInput): Promise<{ record: { id: string; checksum: string }; created: boolean }> {
    // Try to find existing
    const existing = await this.db.rawRecord.findUnique({
      where: {
        tenantId_dataSourceId_externalId_entityType: {
          tenantId: input.tenantId,
          dataSourceId: input.dataSourceId,
          externalId: input.externalId ?? '',
          entityType: input.entityType,
        },
      },
      select: { id: true, checksum: true },
    });

    if (existing) {
      // Update only if checksum changed
      if (existing.checksum !== input.checksum) {
        const updated = await this.db.rawRecord.update({
          where: { id: existing.id },
          data: {
            payload: asJson(input.payload) as Prisma.InputJsonValue,
            checksum: input.checksum,
            syncJobId: input.syncJobId ?? null,
            processedAt: null,
          },
          select: { id: true, checksum: true },
        });
        return { record: updated, created: false };
      }
      return { record: existing, created: false };
    }

    const created = await this.db.rawRecord.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId,
        syncJobId: input.syncJobId ?? null,
        externalId: input.externalId ?? '',
        entityType: input.entityType,
        payload: asJson(input.payload) as Prisma.InputJsonValue,
        checksum: input.checksum,
      },
      select: { id: true, checksum: true },
    });
    return { record: created, created: true };
  }

  async markProcessed({ id }: { id: string }) {
    return this.db.rawRecord.update({
      where: { id },
      data: { processedAt: new Date() },
    });
  }

  async list({
    tenantId,
    dataSourceId,
    entityType,
    skip,
    take,
    unprocessedOnly,
  }: {
    tenantId: string;
    dataSourceId: string;
    entityType?: string;
    skip: number;
    take: number;
    unprocessedOnly?: boolean;
  }) {
    const where = {
      tenantId,
      dataSourceId,
      ...(entityType ? { entityType } : {}),
      ...(unprocessedOnly ? { processedAt: null } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.rawRecord.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.rawRecord.count({ where }),
    ]);
    return { items, total };
  }

  async listVisionPending({ tenantId, take = 50 }: { tenantId: string; take?: number }) {
    return this.db.rawRecord.findMany({
      where: {
        tenantId,
        processedAt: null,
        entityType: { in: ['sale', 'expense'] },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
