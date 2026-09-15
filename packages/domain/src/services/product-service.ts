import type { ProductRepository, ProductStatus } from '@tactia/database';
import {
  AppError,
  ErrorCode,
  paginationArgs,
  type RequestContext,
} from '@tactia/shared';
import { assertRole, assertTenantContext } from '../authz';
import { createProductSchema, listQuerySchema, updateProductSchema } from '../schemas/business';
import { mapMoneyFields } from '../utils/serialize';
import { AuditAction, type AuditLogService } from './audit-log-service';
import type { CatalogEmbeddingService } from './catalog-embedding-service';
import type { CustomDataValidationService } from './custom-data-validation-service';

const MONEY = ['cost', 'price'] as const;

type ProductDto = {
  id: string;
  tenantId: string;
  name: string;
  sku: string | null;
  category: string | null;
  cost: number | null;
  price: number | null;
  status: string;
  externalId: string | null;
  metadata: unknown;
  customData: unknown;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  dataSourceId: string | null;
};

export class ProductService {
  constructor(
    private readonly products: ProductRepository,
    private readonly auditLogs: AuditLogService,
    private readonly catalog?: CatalogEmbeddingService,
    private readonly customData?: CustomDataValidationService,
  ) {}

  private serialize(product: Record<string, unknown>): ProductDto {
    return mapMoneyFields(product, MONEY) as ProductDto;
  }

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listQuerySchema.parse(query);
    const { skip, take } = paginationArgs(parsed);
    const result = await this.products.list({
      tenantId: ctx.tenantId,
      skip,
      take,
      status: parsed.status as ProductStatus | undefined,
      search: parsed.search,
    });
    return {
      items: result.items.map((p) => this.serialize(p as unknown as Record<string, unknown>)),
      total: result.total,
      pagination: { page: parsed.page, pageSize: parsed.pageSize },
    };
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const product = await this.products.findById({ tenantId: ctx.tenantId, id });
    if (!product) throw new AppError(ErrorCode.NOT_FOUND, 'Product not found');
    return this.serialize(product as unknown as Record<string, unknown>);
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertRole(ctx, 'member');
    const input = createProductSchema.parse(raw);
    const customData = this.customData
      ? await this.customData.validate(ctx.tenantId, 'product', input.customData ?? {})
      : (input.customData ?? {});
    const product = await this.products.create({
      tenantId: ctx.tenantId,
      name: input.name,
      sku: input.sku,
      category: input.category,
      cost: input.cost,
      price: input.price,
      status: input.status,
      externalId: input.externalId,
      metadata: input.metadata ?? undefined,
      customData,
    });
    await this.auditLogs.record(ctx, {
      action: AuditAction.PRODUCT_CREATED,
      entityType: 'product',
      entityId: product.id,
      metadata: { name: product.name },
    });
    if (this.catalog) {
      await this.catalog.embedOneProduct(ctx.tenantId, product);
    }
    return this.serialize(product as unknown as Record<string, unknown>);
  }

  async update(ctx: RequestContext, id: string, raw: unknown) {
    assertRole(ctx, 'member');
    const input = updateProductSchema.parse(raw);
    const customData =
      input.customData !== undefined && this.customData
        ? await this.customData.validate(ctx.tenantId, 'product', input.customData)
        : input.customData;
    const product = await this.products.update({
      tenantId: ctx.tenantId,
      id,
      data: {
        name: input.name,
        sku: input.sku,
        category: input.category,
        cost: input.cost,
        price: input.price,
        status: input.status,
        externalId: input.externalId,
        metadata: input.metadata,
        customData,
      },
    });
    if (!product) throw new AppError(ErrorCode.NOT_FOUND, 'Product not found');
    await this.auditLogs.record(ctx, {
      action: AuditAction.PRODUCT_UPDATED,
      entityType: 'product',
      entityId: id,
      metadata: { ...input },
    });
    if (this.catalog) {
      await this.catalog.embedOneProduct(ctx.tenantId, product);
    }
    return this.serialize(product as unknown as Record<string, unknown>);
  }

  async remove(ctx: RequestContext, id: string) {
    assertRole(ctx, 'member');
    const product = await this.products.softDelete({ tenantId: ctx.tenantId, id });
    if (!product) throw new AppError(ErrorCode.NOT_FOUND, 'Product not found');
    await this.auditLogs.record(ctx, {
      action: AuditAction.PRODUCT_DELETED,
      entityType: 'product',
      entityId: id,
    });
    return this.serialize(product as unknown as Record<string, unknown>);
  }
}
