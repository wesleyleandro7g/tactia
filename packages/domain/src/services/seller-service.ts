import type { SellerRepository, SellerStatus } from '@tactia/database';
import {
  AppError,
  ErrorCode,
  paginationArgs,
  type RequestContext,
} from '@tactia/shared';
import { assertRole, assertTenantContext } from '../authz';
import { createSellerSchema, listQuerySchema, updateSellerSchema } from '../schemas/business';
import { AuditAction, type AuditLogService } from './audit-log-service';

export class SellerService {
  constructor(
    private readonly sellers: SellerRepository,
    private readonly auditLogs: AuditLogService,
  ) {}

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listQuerySchema.parse(query);
    const { skip, take } = paginationArgs(parsed);
    const result = await this.sellers.list({
      tenantId: ctx.tenantId,
      skip,
      take,
      status: parsed.status as SellerStatus | undefined,
      search: parsed.search,
    });
    return { ...result, pagination: { page: parsed.page, pageSize: parsed.pageSize } };
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const seller = await this.sellers.findById({ tenantId: ctx.tenantId, id });
    if (!seller) throw new AppError(ErrorCode.NOT_FOUND, 'Seller not found');
    return seller;
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertRole(ctx, 'member');
    const input = createSellerSchema.parse(raw);
    const seller = await this.sellers.create({ tenantId: ctx.tenantId, ...input });
    await this.auditLogs.record(ctx, {
      action: AuditAction.SELLER_CREATED,
      entityType: 'seller',
      entityId: seller.id,
      metadata: { name: seller.name },
    });
    return seller;
  }

  async update(ctx: RequestContext, id: string, raw: unknown) {
    assertRole(ctx, 'member');
    const input = updateSellerSchema.parse(raw);
    const seller = await this.sellers.update({ tenantId: ctx.tenantId, id, data: input });
    if (!seller) throw new AppError(ErrorCode.NOT_FOUND, 'Seller not found');
    await this.auditLogs.record(ctx, {
      action: AuditAction.SELLER_UPDATED,
      entityType: 'seller',
      entityId: id,
      metadata: input,
    });
    return seller;
  }

  async remove(ctx: RequestContext, id: string) {
    assertRole(ctx, 'member');
    const seller = await this.sellers.softDelete({ tenantId: ctx.tenantId, id });
    if (!seller) throw new AppError(ErrorCode.NOT_FOUND, 'Seller not found');
    await this.auditLogs.record(ctx, {
      action: AuditAction.SELLER_DELETED,
      entityType: 'seller',
      entityId: id,
    });
    return seller;
  }
}
