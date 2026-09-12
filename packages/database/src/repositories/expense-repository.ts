import { createId } from '@tactia/shared';
import { Prisma, type PrismaClient } from '../client';

export type CreateExpenseInput = {
  tenantId: string;
  dataSourceId?: string | null;
  externalId?: string | null;
  category: string;
  description?: string | null;
  amount: number;
  occurredAt: Date;
  recurring?: boolean;
  supplier?: string | null;
};

export class ExpenseRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateExpenseInput) {
    return this.db.expense.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId ?? null,
        externalId: input.externalId ?? null,
        category: input.category,
        description: input.description ?? null,
        amount: input.amount,
        occurredAt: input.occurredAt,
        recurring: input.recurring ?? false,
        supplier: input.supplier ?? null,
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.expense.findFirst({ where: { id, tenantId } });
  }

  async list({
    tenantId,
    skip,
    take,
  }: {
    tenantId: string;
    skip: number;
    take: number;
  }) {
    const where: Prisma.ExpenseWhereInput = { tenantId };
    const [items, total] = await Promise.all([
      this.db.expense.findMany({
        where,
        skip,
        take,
        orderBy: { occurredAt: 'desc' },
      }),
      this.db.expense.count({ where }),
    ]);
    return { items, total };
  }

  async upsertByExternalId(
    input: CreateExpenseInput & { dataSourceId: string; externalId: string },
  ) {
    const existing = await this.db.expense.findFirst({
      where: {
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId,
        externalId: input.externalId,
      },
    });

    if (existing) {
      const updated = await this.db.expense.update({
        where: { id: existing.id },
        data: {
          category: input.category,
          description: input.description ?? null,
          amount: input.amount,
          occurredAt: input.occurredAt,
          recurring: input.recurring ?? existing.recurring,
          supplier: input.supplier ?? null,
        },
      });
      return { entity: updated, created: false };
    }

    const created = await this.create(input);
    return { entity: created, created: true };
  }
}
