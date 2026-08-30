import type { MembershipRepository, TenantRepository } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import { assertAuthenticated, assertOwnerOrAdmin } from '../authz';
import { createTenantSchema, updateTenantSchema } from '../schemas/identity';
import { AuditAction, type AuditLogService } from './audit-log-service';

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export class TenantService {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly memberships: MembershipRepository,
    private readonly auditLogs: AuditLogService,
  ) {}

  async create(ctx: RequestContext, raw: unknown) {
    assertAuthenticated(ctx);
    const input = createTenantSchema.parse(raw);
    const slug = input.slug ?? slugify(input.name);
    if (!slug) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Unable to derive a valid slug');
    }

    const existing = await this.tenants.findBySlug(slug);
    if (existing) {
      throw new AppError(ErrorCode.CONFLICT, 'A company with this slug already exists');
    }

    const tenant = await this.tenants.create({
      name: input.name,
      slug,
      timezone: input.timezone,
      currency: input.currency,
    });

    await this.memberships.create({
      tenantId: tenant.id,
      userId: ctx.userId,
      role: 'owner',
    });

    await this.auditLogs.record(
      { ...ctx, tenantId: tenant.id },
      {
        action: AuditAction.TENANT_CREATED,
        entityType: 'tenant',
        entityId: tenant.id,
        metadata: { name: tenant.name, slug: tenant.slug },
      },
    );

    await this.auditLogs.record(
      { ...ctx, tenantId: tenant.id },
      {
        action: AuditAction.MEMBERSHIP_CREATED,
        entityType: 'membership',
        entityId: tenant.id,
        metadata: { role: 'owner', userId: ctx.userId },
      },
    );

    return tenant;
  }

  async listForUser(ctx: RequestContext) {
    assertAuthenticated(ctx);
    const memberships = await this.memberships.listByUserId(ctx.userId);
    return memberships
      .filter((m) => m.tenant.status !== 'deleted')
      .map((m) => ({
        ...m.tenant,
        role: m.role,
        membershipId: m.id,
      }));
  }

  async get(ctx: RequestContext, id: string) {
    assertAuthenticated(ctx);
    const membership = await this.memberships.findByUserAndTenant({
      tenantId: id,
      userId: ctx.userId,
    });
    if (!membership) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Tenant not found');
    }
    const tenant = await this.tenants.findById({ tenantId: id });
    if (!tenant) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Tenant not found');
    }
    return { ...tenant, role: membership.role };
  }

  async update(ctx: RequestContext, raw: unknown) {
    assertOwnerOrAdmin(ctx);
    const input = updateTenantSchema.parse(raw);
    const tenant = await this.tenants.update({ tenantId: ctx.tenantId, data: input });
    return tenant;
  }

  async switch(ctx: RequestContext, tenantId: string) {
    assertAuthenticated(ctx);
    const membership = await this.memberships.findByUserAndTenant({
      tenantId,
      userId: ctx.userId,
    });
    if (!membership || membership.status !== 'active') {
      throw new AppError(ErrorCode.NOT_FOUND, 'Tenant not found');
    }
    return { tenantId, role: membership.role };
  }

  async resolveActiveMembership(userId: string, preferredTenantId?: string | null) {
    const memberships = await this.memberships.listByUserId(userId);
    const active = memberships.filter((m) => m.tenant.status === 'active');
    if (preferredTenantId) {
      const match = active.find((m) => m.tenantId === preferredTenantId);
      if (match) return match;
    }
    return active[0] ?? null;
  }
}
