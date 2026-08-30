import type { MembershipRepository, UserRepository } from '@tactia/database';
import {
  AppError,
  ErrorCode,
  paginationArgs,
  paginationQuerySchema,
  type RequestContext,
} from '@tactia/shared';
import { assertAuthenticated, assertOwnerOrAdmin, assertTenantContext } from '../authz';
import type { AuthProvider } from '../ports/auth-provider';
import { createUserSchema, updateUserSchema } from '../schemas/identity';
import { AuditAction, type AuditLogService } from './audit-log-service';

export class UserService {
  constructor(
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
    private readonly auditLogs: AuditLogService,
    private readonly authProvider: AuthProvider,
  ) {}

  async ensureFromExternalAuth(input: {
    externalAuthId: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
  }) {
    const existing = await this.users.findByExternalAuthId(input.externalAuthId);
    if (existing) return existing;
    return this.users.create(input);
  }

  async getMe(ctx: RequestContext) {
    assertAuthenticated(ctx);
    const user = await this.users.findByDomainId(ctx.userId);
    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
    }
    const memberships = await this.memberships.listByUserId(ctx.userId);
    return {
      ...user,
      memberships: memberships.map((m) => ({
        id: m.id,
        tenantId: m.tenantId,
        role: m.role,
        status: m.status,
        tenant: m.tenant,
      })),
      activeTenantId: ctx.tenantId,
      role: ctx.role,
    };
  }

  async list(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertTenantContext(ctx);
    const pagination = paginationQuerySchema.parse(query);
    const { skip, take } = paginationArgs(pagination);
    const result = await this.users.listByTenant({ tenantId: ctx.tenantId, skip, take });
    return { ...result, pagination };
  }

  async get(ctx: RequestContext, id: string) {
    assertTenantContext(ctx);
    const user = await this.users.findById({ tenantId: ctx.tenantId, id });
    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
    }
    return user;
  }

  async create(ctx: RequestContext, raw: unknown) {
    assertOwnerOrAdmin(ctx);
    const input = createUserSchema.parse(raw);

    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      const already = await this.memberships.findByUserAndTenant({
        tenantId: ctx.tenantId,
        userId: existing.id,
      });
      if (already) {
        throw new AppError(ErrorCode.CONFLICT, 'User already belongs to this company');
      }
      const membership = await this.memberships.create({
        tenantId: ctx.tenantId,
        userId: existing.id,
        role: input.role,
      });
      await this.auditLogs.record(ctx, {
        action: AuditAction.MEMBERSHIP_CREATED,
        entityType: 'membership',
        entityId: membership.id,
        metadata: { userId: existing.id, role: input.role },
      });
      return { user: existing, membership };
    }

    const authUser = await this.authProvider.createCredentialsUser({
      email: input.email,
      name: input.name,
      password: input.password,
    });

    const user = await this.ensureFromExternalAuth({
      externalAuthId: authUser.externalAuthId,
      name: input.name,
      email: input.email,
    });

    const membership = await this.memberships.create({
      tenantId: ctx.tenantId,
      userId: user.id,
      role: input.role,
    });

    await this.auditLogs.record(ctx, {
      action: AuditAction.USER_CREATED,
      entityType: 'user',
      entityId: user.id,
      metadata: { email: user.email },
    });
    await this.auditLogs.record(ctx, {
      action: AuditAction.MEMBERSHIP_CREATED,
      entityType: 'membership',
      entityId: membership.id,
      metadata: { userId: user.id, role: input.role },
    });

    return { user, membership };
  }

  async update(ctx: RequestContext, id: string, raw: unknown) {
    assertTenantContext(ctx);
    const input = updateUserSchema.parse(raw);
    if (ctx.userId !== id) {
      assertOwnerOrAdmin(ctx);
    }
    const user = await this.users.update({ tenantId: ctx.tenantId, id, data: input });
    if (!user) {
      throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
    }
    return user;
  }
}
