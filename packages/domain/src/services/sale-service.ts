import type {
  CustomerRepository,
  ProductRepository,
  SaleRepository,
  SaleStatus,
  SellerRepository,
} from '@tactia/database';
import {
  AppError,
  ErrorCode,
  paginationArgs,
  type RequestContext,
} from '@tactia/shared';
import { assertRole, assertTenantContext } from '../authz';
import { createSaleSchema, listQuerySchema, updateSaleSchema } from '../schemas/business';
import { decimalToNumber, mapMoneyFields } from '../utils/serialize';
import { AuditAction, type AuditLogService } from './audit-log-service';

const SALE_MONEY = ['totalAmount', 'discountAmount'] as const;
const ITEM_MONEY = ['quantity', 'unitPrice', 'discountAmount', 'totalAmount'] as const;

type SaleItemDto = Record<string, unknown> & {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  totalAmount: number;
};

type SaleDto = Record<string, unknown> & {
  id: string;
  tenantId: string;
  customerId: string;
  sellerId: string | null;
  totalAmount: number;
  discountAmount: number;
  currency: string;
  status: string;
  soldAt: Date;
  items: SaleItemDto[];
};

export class SaleService {
  constructor(
    private readonly sales: SaleRepository,
    private readonly customers: CustomerRepository,
    private readonly products: ProductRepository,
    private readonly sellers: SellerRepository,
    private readonly auditLogs: AuditLogService,
  ) {}

  private serialize(sale: Record<string, unknown> & { items?: Array<Record<string, unknown>> }): SaleDto {
    const base = mapMoneyFields(sale, SALE_MONEY);
    return {
      ...base,
      items: (sale.items ?? []).map((item) => mapMoneyFields(item, ITEM_MONEY) as SaleItemDto),
    } as SaleDto;
  }

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listQuerySchema.parse(query);
    const { skip, take } = paginationArgs(parsed);
    const result = await this.sales.list({
      tenantId: ctx.tenantId,
      skip,
      take,
      status: parsed.status as SaleStatus | undefined,
      customerId: parsed.customerId,
      sellerId: parsed.sellerId,
      search: parsed.search,
    });
    return {
      items: result.items.map((s) =>
        this.serialize(s as unknown as Record<string, unknown> & { items?: Array<Record<string, unknown>> }),
      ),
      total: result.total,
      pagination: { page: parsed.page, pageSize: parsed.pageSize },
    };
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const sale = await this.sales.findById({ tenantId: ctx.tenantId, id });
    if (!sale) throw new AppError(ErrorCode.NOT_FOUND, 'Sale not found');
    return this.serialize(
      sale as unknown as Record<string, unknown> & { items?: Array<Record<string, unknown>> },
    );
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertRole(ctx, 'member');
    const input = createSaleSchema.parse(raw);

    const customer = await this.customers.findById({
      tenantId: ctx.tenantId,
      id: input.customerId,
    });
    if (!customer) throw new AppError(ErrorCode.NOT_FOUND, 'Customer not found');

    if (input.sellerId) {
      const seller = await this.sellers.findById({ tenantId: ctx.tenantId, id: input.sellerId });
      if (!seller) throw new AppError(ErrorCode.NOT_FOUND, 'Seller not found');
    }

    const items = [];
    for (const item of input.items) {
      const product = await this.products.findById({
        tenantId: ctx.tenantId,
        id: item.productId,
      });
      if (!product) {
        throw new AppError(ErrorCode.NOT_FOUND, `Product not found: ${item.productId}`);
      }
      const discount = item.discountAmount ?? 0;
      const totalAmount = item.totalAmount ?? item.quantity * item.unitPrice - discount;
      items.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountAmount: discount,
        totalAmount,
      });
    }

    const itemsTotal = items.reduce((sum, i) => sum + i.totalAmount, 0);
    const discountAmount = input.discountAmount ?? 0;
    const totalAmount = input.totalAmount ?? itemsTotal - discountAmount;

    const sale = await this.sales.create({
      tenantId: ctx.tenantId,
      customerId: input.customerId,
      sellerId: input.sellerId,
      totalAmount,
      discountAmount,
      currency: input.currency,
      status: input.status,
      soldAt: input.soldAt,
      externalId: input.externalId,
      metadata: input.metadata ?? undefined,
      items,
    });

    await this.auditLogs.record(ctx, {
      action: AuditAction.SALE_CREATED,
      entityType: 'sale',
      entityId: sale.id,
      metadata: {
        totalAmount,
        customerId: input.customerId,
        itemCount: items.length,
      },
    });

    return this.serialize(
      sale as unknown as Record<string, unknown> & { items?: Array<Record<string, unknown>> },
    );
  }

  async update(ctx: RequestContext, id: string, raw: unknown) {
    assertRole(ctx, 'member');
    const input = updateSaleSchema.parse(raw);

    if (input.customerId) {
      const customer = await this.customers.findById({
        tenantId: ctx.tenantId,
        id: input.customerId,
      });
      if (!customer) throw new AppError(ErrorCode.NOT_FOUND, 'Customer not found');
    }
    if (input.sellerId) {
      const seller = await this.sellers.findById({ tenantId: ctx.tenantId, id: input.sellerId });
      if (!seller) throw new AppError(ErrorCode.NOT_FOUND, 'Seller not found');
    }

    const sale = await this.sales.update({
      tenantId: ctx.tenantId,
      id,
      data: {
        customerId: input.customerId,
        sellerId: input.sellerId,
        totalAmount: input.totalAmount,
        discountAmount: input.discountAmount,
        currency: input.currency,
        status: input.status,
        soldAt: input.soldAt,
        externalId: input.externalId,
        metadata: input.metadata,
      },
    });
    if (!sale) throw new AppError(ErrorCode.NOT_FOUND, 'Sale not found');

    await this.auditLogs.record(ctx, {
      action: AuditAction.SALE_UPDATED,
      entityType: 'sale',
      entityId: id,
      metadata: { ...input, soldAt: input.soldAt?.toISOString() },
    });

    return this.serialize(
      sale as unknown as Record<string, unknown> & { items?: Array<Record<string, unknown>> },
    );
  }

  async remove(ctx: RequestContext, id: string) {
    assertRole(ctx, 'member');
    const sale = await this.sales.delete({ tenantId: ctx.tenantId, id });
    if (!sale) throw new AppError(ErrorCode.NOT_FOUND, 'Sale not found');
    await this.auditLogs.record(ctx, {
      action: AuditAction.SALE_DELETED,
      entityType: 'sale',
      entityId: id,
      metadata: { totalAmount: decimalToNumber(sale.totalAmount) },
    });
    return this.serialize(
      sale as unknown as Record<string, unknown> & { items?: Array<Record<string, unknown>> },
    );
  }
}
