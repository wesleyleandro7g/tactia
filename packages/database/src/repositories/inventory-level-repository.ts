import { createId } from '@tactia/shared';
import type { PrismaClient } from '../client';

export type CreateInventoryLevelInput = {
  tenantId: string;
  dataSourceId?: string | null;
  externalId?: string | null;
  productId: string;
  quantity: number;
  minQuantity?: number | null;
  recordedAt: Date;
};

export class InventoryLevelRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateInventoryLevelInput) {
    return this.db.inventoryLevel.create({
      data: {
        id: createId(),
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId ?? null,
        externalId: input.externalId ?? null,
        productId: input.productId,
        quantity: input.quantity,
        minQuantity: input.minQuantity ?? null,
        recordedAt: input.recordedAt,
      },
    });
  }

  async listLatestByProduct(tenantId: string) {
    return this.db.inventoryLevel.findMany({
      where: { tenantId },
      orderBy: [{ productId: 'asc' }, { recordedAt: 'desc' }, { createdAt: 'desc' }],
      distinct: ['productId'],
    });
  }

  async upsertByExternalId(
    input: CreateInventoryLevelInput & { dataSourceId: string; externalId: string },
  ) {
    const existing = await this.db.inventoryLevel.findFirst({
      where: {
        tenantId: input.tenantId,
        dataSourceId: input.dataSourceId,
        externalId: input.externalId,
      },
    });

    if (existing) {
      const updated = await this.db.inventoryLevel.update({
        where: { id: existing.id },
        data: {
          productId: input.productId,
          quantity: input.quantity,
          minQuantity: input.minQuantity ?? null,
          recordedAt: input.recordedAt,
        },
      });
      return { entity: updated, created: false };
    }

    const created = await this.create(input);
    return { entity: created, created: true };
  }
}
