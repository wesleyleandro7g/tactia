import type {
  CustomerRepository,
  LeadRepository,
  LeadStatus,
  PrismaClient,
} from '@tactia/database';
import {
  AppError,
  createId,
  ErrorCode,
  paginationArgs,
  type RequestContext,
} from '@tactia/shared';
import { assertRole, assertTenantContext } from '../authz';
import { createLeadSchema, listQuerySchema, updateLeadSchema } from '../schemas/business';
import { AuditAction, type AuditLogService } from './audit-log-service';

export class LeadService {
  constructor(
    private readonly leads: LeadRepository,
    private readonly customers: CustomerRepository,
    private readonly auditLogs: AuditLogService,
    private readonly db: PrismaClient,
  ) {}

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listQuerySchema.parse(query);
    const { skip, take } = paginationArgs(parsed);
    const result = await this.leads.list({
      tenantId: ctx.tenantId,
      skip,
      take,
      status: parsed.status as LeadStatus | undefined,
      search: parsed.search,
    });
    return { ...result, pagination: { page: parsed.page, pageSize: parsed.pageSize } };
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const lead = await this.leads.findById({ tenantId: ctx.tenantId, id });
    if (!lead) throw new AppError(ErrorCode.NOT_FOUND, 'Lead not found');
    return lead;
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertRole(ctx, 'member');
    const input = createLeadSchema.parse(raw);
    if (input.customerId) {
      const customer = await this.customers.findById({
        tenantId: ctx.tenantId,
        id: input.customerId,
      });
      if (!customer) throw new AppError(ErrorCode.NOT_FOUND, 'Customer not found');
    }
    const lead = await this.leads.create({ tenantId: ctx.tenantId, ...input });
    await this.auditLogs.record(ctx, {
      action: AuditAction.LEAD_CREATED,
      entityType: 'lead',
      entityId: lead.id,
      metadata: { name: lead.name, status: lead.status },
    });
    return lead;
  }

  async update(ctx: RequestContext, id: string, raw: unknown) {
    assertRole(ctx, 'member');
    const input = updateLeadSchema.parse(raw);
    if (input.customerId) {
      const customer = await this.customers.findById({
        tenantId: ctx.tenantId,
        id: input.customerId,
      });
      if (!customer) throw new AppError(ErrorCode.NOT_FOUND, 'Customer not found');
    }
    const existing = await this.leads.findById({ tenantId: ctx.tenantId, id });
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, 'Lead not found');
    const lead = await this.leads.update({ tenantId: ctx.tenantId, id, data: input });
    if (!lead) throw new AppError(ErrorCode.NOT_FOUND, 'Lead not found');
    if (input.status && input.status !== existing.status) {
      await this.db.leadStageTransition.create({
        data: {
          id: createId(),
          tenantId: ctx.tenantId,
          leadId: id,
          fromStatus: existing.status,
          toStatus: input.status,
          occurredAt: new Date(),
          sellerId: lead.sellerId ?? existing.sellerId,
        },
      });
    }
    await this.auditLogs.record(ctx, {
      action: AuditAction.LEAD_UPDATED,
      entityType: 'lead',
      entityId: id,
      metadata: input,
    });
    return lead;
  }

  async remove(ctx: RequestContext, id: string) {
    assertRole(ctx, 'member');
    const lead = await this.leads.delete({ tenantId: ctx.tenantId, id });
    if (!lead) throw new AppError(ErrorCode.NOT_FOUND, 'Lead not found');
    await this.auditLogs.record(ctx, {
      action: AuditAction.LEAD_DELETED,
      entityType: 'lead',
      entityId: id,
    });
    return lead;
  }
}
