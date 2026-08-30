import type {
  ActivityRepository,
  ActivityType,
  CustomerRepository,
  LeadRepository,
  SellerRepository,
} from '@tactia/database';
import {
  AppError,
  ErrorCode,
  paginationArgs,
  type RequestContext,
} from '@tactia/shared';
import { assertRole, assertTenantContext } from '../authz';
import { createActivitySchema, listQuerySchema, updateActivitySchema } from '../schemas/business';
import { AuditAction, type AuditLogService } from './audit-log-service';

export class ActivityService {
  constructor(
    private readonly activities: ActivityRepository,
    private readonly customers: CustomerRepository,
    private readonly leads: LeadRepository,
    private readonly sellers: SellerRepository,
    private readonly auditLogs: AuditLogService,
  ) {}

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const parsed = listQuerySchema.parse(query);
    const { skip, take } = paginationArgs(parsed);
    const result = await this.activities.list({
      tenantId: ctx.tenantId,
      skip,
      take,
      type: parsed.type as ActivityType | undefined,
      customerId: parsed.customerId,
      leadId: parsed.leadId,
      sellerId: parsed.sellerId,
    });
    return { ...result, pagination: { page: parsed.page, pageSize: parsed.pageSize } };
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const activity = await this.activities.findById({ tenantId: ctx.tenantId, id });
    if (!activity) throw new AppError(ErrorCode.NOT_FOUND, 'Activity not found');
    return activity;
  }

  private async assertRefs(
    tenantId: string,
    refs: { customerId?: string | null; leadId?: string | null; sellerId?: string | null },
  ) {
    if (refs.customerId) {
      const customer = await this.customers.findById({ tenantId, id: refs.customerId });
      if (!customer) throw new AppError(ErrorCode.NOT_FOUND, 'Customer not found');
    }
    if (refs.leadId) {
      const lead = await this.leads.findById({ tenantId, id: refs.leadId });
      if (!lead) throw new AppError(ErrorCode.NOT_FOUND, 'Lead not found');
    }
    if (refs.sellerId) {
      const seller = await this.sellers.findById({ tenantId, id: refs.sellerId });
      if (!seller) throw new AppError(ErrorCode.NOT_FOUND, 'Seller not found');
    }
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertRole(ctx, 'member');
    const input = createActivitySchema.parse(raw);
    await this.assertRefs(ctx.tenantId, input);
    const activity = await this.activities.create({
      tenantId: ctx.tenantId,
      type: input.type,
      customerId: input.customerId,
      leadId: input.leadId,
      sellerId: input.sellerId,
      occurredAt: input.occurredAt,
      metadata: input.metadata ?? undefined,
    });
    await this.auditLogs.record(ctx, {
      action: AuditAction.ACTIVITY_CREATED,
      entityType: 'activity',
      entityId: activity.id,
      metadata: { type: activity.type },
    });
    return activity;
  }

  async update(ctx: RequestContext, id: string, raw: unknown) {
    assertRole(ctx, 'member');
    const input = updateActivitySchema.parse(raw);
    await this.assertRefs(ctx.tenantId, input);
    const activity = await this.activities.update({
      tenantId: ctx.tenantId,
      id,
      data: {
        type: input.type,
        customerId: input.customerId,
        leadId: input.leadId,
        sellerId: input.sellerId,
        occurredAt: input.occurredAt,
        metadata: input.metadata,
      },
    });
    if (!activity) throw new AppError(ErrorCode.NOT_FOUND, 'Activity not found');
    await this.auditLogs.record(ctx, {
      action: AuditAction.ACTIVITY_UPDATED,
      entityType: 'activity',
      entityId: id,
      metadata: {
        type: input.type,
        customerId: input.customerId,
        leadId: input.leadId,
        sellerId: input.sellerId,
        occurredAt: input.occurredAt?.toISOString(),
      },
    });
    return activity;
  }

  async remove(ctx: RequestContext, id: string) {
    assertRole(ctx, 'member');
    const activity = await this.activities.delete({ tenantId: ctx.tenantId, id });
    if (!activity) throw new AppError(ErrorCode.NOT_FOUND, 'Activity not found');
    await this.auditLogs.record(ctx, {
      action: AuditAction.ACTIVITY_DELETED,
      entityType: 'activity',
      entityId: id,
    });
    return activity;
  }
}
