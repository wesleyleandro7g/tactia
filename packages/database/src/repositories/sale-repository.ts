import { createId } from '@tactia/shared';
import { Prisma, type PrismaClient, type SaleStatus } from '../client';
import { asJson, asNullableJson } from '../json';

export type CreateSaleItemInput = {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
  totalAmount: number;
};

export type CreateSaleInput = {
  tenantId: string;
  dataSourceId?: string | null;
  externalId?: string | null;
  customerId: string;
  sellerId?: string | null;
  totalAmount: number;
  discountAmount?: number;
  currency?: string;
  status?: SaleStatus;
  paymentMethod?: string | null;
  channel?: string | null;
  region?: string | null;
  soldAt: Date;
  metadata?: unknown;
  items: CreateSaleItemInput[];
};

const saleInclude = { items: true } as const;

export class SaleRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateSaleInput) {
    return this.db.sale.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId ?? null,
        externalId: input.externalId ?? null,
        customerId: input.customerId,
        sellerId: input.sellerId ?? null,
        totalAmount: input.totalAmount,
        discountAmount: input.discountAmount ?? 0,
        currency: input.currency ?? 'BRL',
        status: input.status ?? 'confirmed',
        paymentMethod: input.paymentMethod ?? null,
        channel: input.channel ?? null,
        region: input.region ?? null,
        soldAt: input.soldAt,
        metadata: asJson(input.metadata),
        items: {
          create: input.items.map((item) => ({
            id: createId(),
            tenantId: input.tenantId,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discountAmount: item.discountAmount ?? 0,
            totalAmount: item.totalAmount,
          })),
        },
      },
      include: saleInclude,
    });
  }

  async findById({ tenantId, id }: { tenantId: string; id: string }) {
    return this.db.sale.findFirst({
      where: { id, tenantId },
      include: saleInclude,
    });
  }

  async list({
    tenantId,
    skip,
    take,
    status,
    customerId,
    sellerId,
    search,
  }: {
    tenantId: string;
    skip: number;
    take: number;
    status?: SaleStatus;
    customerId?: string;
    sellerId?: string;
    search?: string;
  }) {
    const where: Prisma.SaleWhereInput = {
      tenantId,
      ...(status ? { status } : {}),
      ...(customerId ? { customerId } : {}),
      ...(sellerId ? { sellerId } : {}),
      ...(search ? { externalId: { contains: search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.sale.findMany({
        where,
        skip,
        take,
        orderBy: { soldAt: 'desc' },
        include: saleInclude,
      }),
      this.db.sale.count({ where }),
    ]);
    return { items, total };
  }

  async update({
    tenantId,
    id,
    data,
  }: {
    tenantId: string;
    id: string;
    data: {
      customerId?: string;
      sellerId?: string | null;
      totalAmount?: number;
      discountAmount?: number;
      currency?: string;
      status?: SaleStatus;
      soldAt?: Date;
      metadata?: unknown;
      externalId?: string | null;
    };
  }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    return this.db.sale.update({
      where: { id },
      data: {
        customerId: data.customerId,
        sellerId: data.sellerId,
        totalAmount: data.totalAmount,
        discountAmount: data.discountAmount,
        currency: data.currency,
        status: data.status,
        soldAt: data.soldAt,
        externalId: data.externalId,
        metadata: asNullableJson(data.metadata),
      },
      include: saleInclude,
    });
  }

  async findByExternalId({
    tenantId,
    dataSourceId,
    externalId,
  }: {
    tenantId: string;
    dataSourceId?: string;
    externalId: string;
  }) {
    return this.db.sale.findFirst({
      where: {
        tenantId,
        externalId,
        ...(dataSourceId ? { dataSourceId } : {}),
      },
      select: { id: true },
    });
  }

  /**
   * Upsert by `(tenantId, dataSourceId, externalId)` — the idempotency key of a
   * sync (spec §38). On update the items are replaced, not appended: re-running
   * the same sync must not inflate revenue nor duplicate line items.
   */
  async upsertByExternalId(input: CreateSaleInput & { dataSourceId: string; externalId: string }) {
    const existing = await this.db.sale.findFirst({
      where: {
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId,
        externalId: input.externalId,
      },
      include: saleInclude,
    });

    if (existing) {
      const updated = await this.db.$transaction(async (tx) => {
        await tx.saleItem.deleteMany({ where: { saleId: existing.id } });
        return tx.sale.update({
          where: { id: existing.id },
          data: {
            customerId: input.customerId,
            sellerId: input.sellerId ?? null,
            totalAmount: input.totalAmount,
            discountAmount: input.discountAmount ?? 0,
            currency: input.currency ?? 'BRL',
            status: input.status ?? existing.status,
            paymentMethod: input.paymentMethod ?? null,
            channel: input.channel ?? null,
            region: input.region ?? null,
            soldAt: input.soldAt,
            metadata: asJson(input.metadata),
            items: {
              create: input.items.map((item) => ({
                id: createId(),
                tenantId: input.tenantId,
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                discountAmount: item.discountAmount ?? 0,
                totalAmount: item.totalAmount,
              })),
            },
          },
          include: saleInclude,
        });
      });
      return { entity: updated, created: false };
    }

    const created = await this.create(input);
    return { entity: created, created: true };
  }

  async delete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    await this.db.sale.delete({ where: { id } });
    return existing;
  }
}
