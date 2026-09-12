import { z } from 'zod';
import type { InventoryLevelRepository, ProductRepository } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertRole, assertTenantContext } from '../authz';
import { decimalToNumber } from '../utils/serialize';

export const createInventoryLevelSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().finite(),
  minQuantity: z.number().finite().nullable().optional(),
  recordedAt: z.coerce.date(),
  externalId: z.string().trim().min(1).max(120).nullable().optional(),
});

export class InventoryService {
  constructor(
    private readonly inventory: InventoryLevelRepository,
    private readonly products: ProductRepository,
  ) {}

  async list(ctx: RequestContext) {
    assertTenantContext(ctx);
    const items = await this.inventory.listLatestByProduct(ctx.tenantId);
    return { items: items.map((item) => this.serialize(item)) };
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertRole(ctx, 'member');
    const input = createInventoryLevelSchema.parse(raw);
    const product = await this.products.findById({ tenantId: ctx.tenantId, id: input.productId });
    if (!product) throw new AppError(ErrorCode.NOT_FOUND, 'Product not found');
    const level = await this.inventory.create({ tenantId: ctx.tenantId, ...input });
    return this.serialize(level);
  }

  private serialize(level: Record<string, unknown>) {
    return {
      ...level,
      quantity: decimalToNumber(level['quantity']),
      minQuantity: level['minQuantity'] == null ? null : decimalToNumber(level['minQuantity']),
    };
  }
}
