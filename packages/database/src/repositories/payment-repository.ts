import { createId } from '@tactia/shared';
import { Prisma, type PaymentStatus, type PrismaClient } from '../client';

export type CreatePaymentInput = {
  tenantId: string;
  dataSourceId?: string | null;
  externalId?: string | null;
  saleId: string;
  amount: number;
  method?: string | null;
  dueAt: Date;
  paidAt?: Date | null;
  status?: PaymentStatus;
};

export class PaymentRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreatePaymentInput) {
    return this.db.payment.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId ?? null,
        externalId: input.externalId ?? null,
        saleId: input.saleId,
        amount: input.amount,
        method: input.method ?? null,
        dueAt: input.dueAt,
        paidAt: input.paidAt ?? null,
        status: input.status ?? 'pending',
      },
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.payment.findFirst({ where: { id, tenantId } });
  }

  async list({
    tenantId,
    skip,
    take,
    status,
  }: {
    tenantId: string;
    skip: number;
    take: number;
    status?: PaymentStatus;
  }) {
    const where: Prisma.PaymentWhereInput = {
      tenantId,
      ...(status ? { status } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.payment.findMany({
        where,
        skip,
        take,
        orderBy: { dueAt: 'desc' },
      }),
      this.db.payment.count({ where }),
    ]);
    return { items, total };
  }

  async upsertByExternalId(
    input: CreatePaymentInput & { dataSourceId: string; externalId: string },
  ) {
    const existing = await this.db.payment.findFirst({
      where: {
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId,
        externalId: input.externalId,
      },
    });

    if (existing) {
      const updated = await this.db.payment.update({
        where: { id: existing.id },
        data: {
          saleId: input.saleId,
          amount: input.amount,
          method: input.method ?? null,
          dueAt: input.dueAt,
          paidAt: input.paidAt ?? null,
          status: input.status ?? existing.status,
        },
      });
      return { entity: updated, created: false };
    }

    const created = await this.create(input);
    return { entity: created, created: true };
  }
}
