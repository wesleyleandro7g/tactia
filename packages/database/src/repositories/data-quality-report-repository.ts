import { createId } from '@tactia/shared';
import type { PrismaClient, Prisma } from '../client';
import { asJson } from '../json';

export type CreateDataQualityReportInput = {
  tenantId: string;
  dataSourceId: string;
  syncJobId?: string | null;
  entityType: string;
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  warnings: Array<{ rule: string; count: number; sample?: unknown }>;
  errors: Array<{ rule: string; count: number; sample?: unknown }>;
};

export class DataQualityReportRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateDataQualityReportInput) {
    return this.db.dataQualityReport.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId,
        syncJobId: input.syncJobId ?? null,
        entityType: input.entityType,
        totalRecords: input.totalRecords,
        validRecords: input.validRecords,
        invalidRecords: input.invalidRecords,
        warnings: asJson(input.warnings) as Prisma.InputJsonValue,
        errors: asJson(input.errors) as Prisma.InputJsonValue,
      },
    });
  }

  async list({
    tenantId,
    dataSourceId,
    skip,
    take,
  }: {
    tenantId: string;
    dataSourceId: string;
    skip: number;
    take: number;
  }) {
    const where = { tenantId, dataSourceId };
    const [items, total] = await Promise.all([
      this.db.dataQualityReport.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.db.dataQualityReport.count({ where }),
    ]);
    return { items, total };
  }
}
