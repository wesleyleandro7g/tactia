import type { CustomerRepository, CustomerStatus } from '@tactia/database';
import {
  AppError,
  ErrorCode,
  paginationArgs,
  type RequestContext,
} from '@tactia/shared';
import { assertRole, assertTenantContext } from '../authz';
import { createCustomerSchema, listQuerySchema, updateCustomerSchema } from '../schemas/business';
import { AuditAction, type AuditLogService } from './audit-log-service';

export class CustomerService {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly auditLogs: AuditLogService,
  ) {}

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listQuerySchema.parse(query);
    const { skip, take } = paginationArgs(parsed);
    const result = await this.customers.list({
      tenantId: ctx.tenantId,
      skip,
      take,
      status: parsed.status as CustomerStatus | undefined,
      search: parsed.search,
    });
    return { ...result, pagination: { page: parsed.page, pageSize: parsed.pageSize } };
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const customer = await this.customers.findById({ tenantId: ctx.tenantId, id });
    if (!customer) throw new AppError(ErrorCode.NOT_FOUND, 'Customer not found');
    return customer;
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertRole(ctx, 'member');
    const input = createCustomerSchema.parse(raw);
    const customer = await this.customers.create({
      tenantId: ctx.tenantId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      document: input.document,
      status: input.status,
      externalId: input.externalId,
      metadata: input.metadata ?? undefined,
    });
    await this.auditLogs.record(ctx, {
      action: AuditAction.CUSTOMER_CREATED,
      entityType: 'customer',
      entityId: customer.id,
      metadata: { name: customer.name },
    });
    return customer;
  }

  async update(ctx: RequestContext, id: string, raw: unknown) {
    assertRole(ctx, 'member');
    const input = updateCustomerSchema.parse(raw);
    const customer = await this.customers.update({
      tenantId: ctx.tenantId,
      id,
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        document: input.document,
        status: input.status,
        externalId: input.externalId,
        metadata: input.metadata,
      },
    });
    if (!customer) throw new AppError(ErrorCode.NOT_FOUND, 'Customer not found');
    await this.auditLogs.record(ctx, {
      action: AuditAction.CUSTOMER_UPDATED,
      entityType: 'customer',
      entityId: id,
      metadata: { ...input },
    });
    return customer;
  }

  async remove(ctx: RequestContext, id: string) {
    assertRole(ctx, 'member');
    const customer = await this.customers.softDelete({ tenantId: ctx.tenantId, id });
    if (!customer) throw new AppError(ErrorCode.NOT_FOUND, 'Customer not found');
    await this.auditLogs.record(ctx, {
      action: AuditAction.CUSTOMER_DELETED,
      entityType: 'customer',
      entityId: id,
    });
    return customer;
  }
}
