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

  async delete({ tenantId, id }: { tenantId: string; id: string }) {
    const existing = await this.findById({ tenantId, id });
    if (!existing) return null;
    await this.db.sale.delete({ where: { id } });
    return existing;
  }
}
