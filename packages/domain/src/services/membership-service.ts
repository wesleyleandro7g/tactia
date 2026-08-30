import type { MembershipRepository } from '@tactia/database';
import {
  AppError,
  ErrorCode,
  paginationArgs,
  paginationQuerySchema,
  type RequestContext,
} from '@tactia/shared';
import { assertOwnerOrAdmin, assertTenantContext } from '../authz';
import { createMembershipSchema, updateMembershipSchema } from '../schemas/identity';
import { AuditAction, type AuditLogService } from './audit-log-service';

export class MembershipService {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly auditLogs: AuditLogService,
  ) {}

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const pagination = paginationQuerySchema.parse(query);
    const { skip, take } = paginationArgs(pagination);
    const result = await this.memberships.listByTenant({ tenantId: ctx.tenantId, skip, take });
    return { ...result, pagination };
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const membership = await this.memberships.findById({ tenantId: ctx.tenantId, id });
    if (!membership) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Membership not found');
    }
    return membership;
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertOwnerOrAdmin(ctx);
    const input = createMembershipSchema.parse(raw);
    const existing = await this.memberships.findByUserAndTenant({
      tenantId: ctx.tenantId,
      userId: input.userId,
    });
    if (existing) {
      throw new AppError(ErrorCode.CONFLICT, 'User already belongs to this company');
    }
    const membership = await this.memberships.create({
      tenantId: ctx.tenantId,
      userId: input.userId,
      role: input.role,
    });
    await this.auditLogs.record(ctx, {
      action: AuditAction.MEMBERSHIP_CREATED,
      entityType: 'membership',
      entityId: membership.id,
      metadata: { userId: input.userId, role: input.role },
    });
    return membership;
  }

  async update(ctx: RequestContext, id: string, raw: unknown) {
    assertOwnerOrAdmin(ctx);
    const input = updateMembershipSchema.parse(raw);
    const current = await this.memberships.findById({ tenantId: ctx.tenantId, id });
    if (!current) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Membership not found');
    }
    if (current.role === 'owner' && input.role && input.role !== 'owner') {
      throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Cannot change the owner role');
    }
    if (input.role === 'owner' && ctx.role !== 'owner') {
      throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Only an owner can assign the owner role');
    }
    const membership = await this.memberships.update({
      tenantId: ctx.tenantId,
      id,
      data: input,
    });
    await this.auditLogs.record(ctx, {
      action: AuditAction.MEMBERSHIP_UPDATED,
      entityType: 'membership',
      entityId: id,
      metadata: input,
    });
    return membership;
  }

  async remove(ctx: RequestContext, id: string) {
    assertOwnerOrAdmin(ctx);
    const current = await this.memberships.findById({ tenantId: ctx.tenantId, id });
    if (!current) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Membership not found');
    }
    if (current.role === 'owner') {
      throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Cannot remove the company owner');
    }
    await this.memberships.softDelete({ tenantId: ctx.tenantId, id });
    await this.auditLogs.record(ctx, {
      action: AuditAction.MEMBERSHIP_REMOVED,
      entityType: 'membership',
      entityId: id,
      metadata: { userId: current.userId },
    });
  }
}
