import { createId } from '@tactia/shared';
import type { Prisma, PrismaClient } from '../client';

export type CreateBusinessFactInput = {
  tenantId: string;
  kind: string;
  text: string;
  entityType?: string | null;
  entityId?: string | null;
  validFrom?: Date | null;
  validTo?: Date | null;
  source?: string;
  createdBy?: string | null;
};

export class BusinessFactRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateBusinessFactInput) {
    return this.db.businessFact.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        kind: input.kind,
        text: input.text,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        validFrom: input.validFrom ?? null,
        validTo: input.validTo ?? null,
        source: input.source ?? 'user',
        createdBy: input.createdBy ?? null,
      },
    });
  }

  async listActive(tenantId: string, now: Date) {
    const where: Prisma.BusinessFactWhereInput = {
      tenantId,
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validTo: null }, { validTo: { gte: now } }] },
      ],
    };
    return this.db.businessFact.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async list(tenantId: string) {
    return this.db.businessFact.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.businessFact.findFirst({ where: { id, tenantId } });
  }

  async delete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    await this.db.businessFact.delete({ where: { id } });
    return existing;
  }
}
