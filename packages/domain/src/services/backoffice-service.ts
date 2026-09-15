import type {
  AuditLogRepository,
  DataSourceRepository,
  ImportRepository,
  InsightRepository,
  MembershipRepository,
  SyncJobRepository,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import {
  AppError,
  ErrorCode,
  paginationArgs,
  type RequestContext,
} from '@tactia/shared';
import { assertOperator } from '../authz';
import type { AuthProvider } from '../ports/auth-provider';
import {
  backofficeListTenantsQuerySchema,
  createUserSchema,
  operatorUpdateTenantSchema,
  provisionTenantSchema,
  resetPasswordSchema,
  updateMembershipSchema,
} from '../schemas/identity';
import { previewQuerySchema } from '../schemas/data-platform';
import { listSelectableSourceKinds, sourceKindHasConnector } from '../data-sources/catalog';
import { AuditAction, type AuditLogService } from './audit-log-service';
import type { CredentialService } from './credential-service';
import type { CustomFieldDefinitionService } from './custom-field-definition-service';
import type { DataSourceService } from './data-source-service';
import type { SyncService } from './sync-service';

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function operatorTenantCtx(ctx: RequestContext, tenantId: string): RequestContext {
  return {
    requestId: ctx.requestId,
    tenantId,
    userId: null,
    role: 'owner',
    ip: ctx.ip ?? null,
    operatorId: ctx.operatorId,
  };
}

export class BackofficeService {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
    private readonly dataSources: DataSourceRepository,
    private readonly syncJobs: SyncJobRepository,
    private readonly imports: ImportRepository,
    private readonly insights: InsightRepository,
    private readonly auditLogs: AuditLogService,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly clientAuth: AuthProvider,
    private readonly syncService: SyncService,
    private readonly dataSourceService: DataSourceService,
    private readonly credentialService: CredentialService,
    private readonly customFields?: CustomFieldDefinitionService,
  ) {}

  async listTenants(ctx: RequestContext, query: Record<string, string | undefined>) {
    assertOperator(ctx);
    const input = backofficeListTenantsQuerySchema.parse(query);
    const { skip, take } = paginationArgs(input);
    const result = await this.tenants.listForBackoffice({
      skip,
      take,
      q: input.q,
      status: input.status,
    });
    return { ...result, pagination: { page: input.page, pageSize: input.pageSize } };
  }

  async getTenant(ctx: RequestContext, tenantId: string) {
    assertOperator(ctx);
    const tenant = await this.tenants.findByIdForOperator(tenantId);
    if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, 'Tenant not found');

    const [memberships, dataSources, syncJobs, imports, insights, audit] = await Promise.all([
      this.memberships.listByTenant({ tenantId, skip: 0, take: 100 }),
      this.dataSources.list({ tenantId, skip: 0, take: 50 }),
      this.syncJobs.list({ tenantId, skip: 0, take: 15 }),
      this.imports.list({ tenantId, skip: 0, take: 15 }),
      this.insights.list({ tenantId, page: 1, pageSize: 10, orderBy: 'createdAt' }),
      this.auditLogRepo.list({ tenantId, skip: 0, take: 30 }),
    ]);

    return {
      tenant,
      users: memberships.items,
      dataSources: dataSources.items,
      syncJobs: syncJobs.items,
      imports: imports.items,
      insights: insights.items.map((row) => ({
        id: row.id,
        title: row.title,
        severity: row.severity,
        status: row.status,
        ruleKey: row.ruleKey,
        createdAt: row.createdAt,
      })),
      auditLogs: audit.items,
    };
  }

  async provisionTenant(ctx: RequestContext, raw: unknown) {
    assertOperator(ctx);
    const input = provisionTenantSchema.parse(raw);
    const slug = input.slug ?? slugify(input.name);
    if (!slug) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Unable to derive a valid slug');
    }

    const existingSlug = await this.tenants.findBySlug(slug);
    if (existingSlug) {
      throw new AppError(ErrorCode.CONFLICT, 'A company with this slug already exists');
    }

    const existingOwner = await this.users.findByEmail(input.ownerEmail);
    if (existingOwner) {
      throw new AppError(ErrorCode.CONFLICT, 'A user with this email already exists');
    }

    const tenant = await this.tenants.create({
      name: input.name,
      slug,
      timezone: input.timezone,
      currency: input.currency,
    });

    const operatorCtx = operatorTenantCtx(ctx, tenant.id);

    const authUser = await this.clientAuth.createCredentialsUser({
      email: input.ownerEmail,
      name: input.ownerName,
      password: input.ownerPassword,
    });

    const user = await this.users.create({
      externalAuthId: authUser.externalAuthId,
      name: input.ownerName,
      email: input.ownerEmail,
    });

    const membership = await this.memberships.create({
      tenantId: tenant.id,
      userId: user.id,
      role: 'owner',
    });

    await this.auditLogs.record(operatorCtx, {
      action: AuditAction.TENANT_CREATED,
      entityType: 'tenant',
      entityId: tenant.id,
      metadata: { name: tenant.name, slug: tenant.slug },
    });
    await this.auditLogs.record(operatorCtx, {
      action: AuditAction.USER_CREATED,
      entityType: 'user',
      entityId: user.id,
      metadata: { email: user.email },
    });
    await this.auditLogs.record(operatorCtx, {
      action: AuditAction.MEMBERSHIP_CREATED,
      entityType: 'membership',
      entityId: membership.id,
      metadata: { userId: user.id, role: 'owner' },
    });

    return { tenant, user, membership };
  }

  async updateTenant(ctx: RequestContext, tenantId: string, raw: unknown) {
    assertOperator(ctx);
    const tenant = await this.tenants.findByIdForOperator(tenantId);
    if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, 'Tenant not found');

    const input = operatorUpdateTenantSchema.parse(raw);
    const hasProfile =
      input.name !== undefined || input.timezone !== undefined || input.currency !== undefined;
    const hasStatus = input.status !== undefined;
    if (!hasProfile && !hasStatus) return tenant;

    if (input.status && input.status !== tenant.status) {
      if (input.status === 'suspended' && tenant.status !== 'active') {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Only an active company can be suspended');
      }
      if (input.status === 'active' && tenant.status !== 'suspended') {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Only a suspended company can be reactivated');
      }
    }

    const updated = await this.tenants.update({
      tenantId,
      data: {
        name: input.name,
        timezone: input.timezone,
        currency: input.currency,
        status: input.status,
      },
    });

    const operatorCtx = operatorTenantCtx(ctx, tenantId);
    if (input.status === 'suspended') {
      await this.auditLogs.record(operatorCtx, {
        action: AuditAction.TENANT_SUSPENDED,
        entityType: 'tenant',
        entityId: tenantId,
      });
    } else if (input.status === 'active' && tenant.status === 'suspended') {
      await this.auditLogs.record(operatorCtx, {
        action: AuditAction.TENANT_REACTIVATED,
        entityType: 'tenant',
        entityId: tenantId,
      });
    } else {
      await this.auditLogs.record(operatorCtx, {
        action: AuditAction.TENANT_UPDATED,
        entityType: 'tenant',
        entityId: tenantId,
        metadata: { name: input.name, timezone: input.timezone, currency: input.currency },
      });
    }

    return updated;
  }

  async addUser(ctx: RequestContext, tenantId: string, raw: unknown) {
    assertOperator(ctx);
    const tenant = await this.tenants.findByIdForOperator(tenantId);
    if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, 'Tenant not found');

    const input = createUserSchema.parse(raw);
    const operatorCtx = operatorTenantCtx(ctx, tenantId);

    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      const already = await this.memberships.findByUserAndTenant({
        tenantId,
        userId: existing.id,
      });
      if (already) {
        throw new AppError(ErrorCode.CONFLICT, 'User already belongs to this company');
      }
      const membership = await this.memberships.create({
        tenantId,
        userId: existing.id,
        role: input.role,
      });
      await this.auditLogs.record(operatorCtx, {
        action: AuditAction.MEMBERSHIP_CREATED,
        entityType: 'membership',
        entityId: membership.id,
        metadata: { userId: existing.id, role: input.role },
      });
      return { user: existing, membership };
    }

    const authUser = await this.clientAuth.createCredentialsUser({
      email: input.email,
      name: input.name,
      password: input.password,
    });

    const user = await this.users.create({
      externalAuthId: authUser.externalAuthId,
      name: input.name,
      email: input.email,
    });

    const membership = await this.memberships.create({
      tenantId,
      userId: user.id,
      role: input.role,
    });

    await this.auditLogs.record(operatorCtx, {
      action: AuditAction.USER_CREATED,
      entityType: 'user',
      entityId: user.id,
      metadata: { email: user.email },
    });
    await this.auditLogs.record(operatorCtx, {
      action: AuditAction.MEMBERSHIP_CREATED,
      entityType: 'membership',
      entityId: membership.id,
      metadata: { userId: user.id, role: input.role },
    });

    return { user, membership };
  }

  async updateMembership(ctx: RequestContext, tenantId: string, membershipId: string, raw: unknown) {
    assertOperator(ctx);
    const tenant = await this.tenants.findByIdForOperator(tenantId);
    if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, 'Tenant not found');

    const input = updateMembershipSchema.parse(raw);
    const current = await this.memberships.findById({ tenantId, id: membershipId });
    if (!current) throw new AppError(ErrorCode.NOT_FOUND, 'Membership not found');

    if (current.role === 'owner' && input.role && input.role !== 'owner') {
      const owners = await this.memberships.countActiveOwners(tenantId);
      if (owners <= 1) {
        throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'Cannot demote the last owner');
      }
    }

    const membership = await this.memberships.update({
      tenantId,
      id: membershipId,
      data: input,
    });

    await this.auditLogs.record(operatorTenantCtx(ctx, tenantId), {
      action: AuditAction.MEMBERSHIP_UPDATED,
      entityType: 'membership',
      entityId: membershipId,
      metadata: input,
    });

    return membership;
  }

  async resetPassword(ctx: RequestContext, tenantId: string, userId: string, raw: unknown) {
    assertOperator(ctx);
    const tenant = await this.tenants.findByIdForOperator(tenantId);
    if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, 'Tenant not found');

    const input = resetPasswordSchema.parse(raw);
    const user = await this.users.findById({ tenantId, id: userId });
    if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'User not found');

    await this.clientAuth.setPassword(user.externalAuthId, input.password);

    await this.auditLogs.record(operatorTenantCtx(ctx, tenantId), {
      action: AuditAction.PASSWORD_RESET,
      entityType: 'user',
      entityId: user.id,
    });

    return { ok: true };
  }

  async triggerSync(ctx: RequestContext, tenantId: string, dataSourceId: string) {
    assertOperator(ctx);
    const tenant = await this.tenants.findByIdForOperator(tenantId);
    if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, 'Tenant not found');

    const dataSource = await this.dataSources.findOwned({ tenantId, id: dataSourceId });
    if (!dataSource) throw new AppError(ErrorCode.NOT_FOUND, 'DataSource not found');

    const operatorCtx = operatorTenantCtx(ctx, tenantId);
    return this.syncService.startSync(operatorCtx, dataSourceId);
  }

  async reprocessImport(ctx: RequestContext, tenantId: string, importId: string) {
    assertOperator(ctx);
    const tenant = await this.tenants.findByIdForOperator(tenantId);
    if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, 'Tenant not found');

    const record = await this.imports.findById({ tenantId, id: importId });
    if (!record) throw new AppError(ErrorCode.NOT_FOUND, 'Import not found');

    const operatorCtx = operatorTenantCtx(ctx, tenantId);
    return this.syncService.startSync(operatorCtx, record.dataSourceId);
  }

  listDataSourceKinds(ctx: RequestContext) {
    assertOperator(ctx);
    return listSelectableSourceKinds();
  }

  async getDataSource(ctx: RequestContext, tenantId: string, dataSourceId: string) {
    const scoped = await this.operatorScope(ctx, tenantId);
    const dataSource = await this.dataSourceService.get(scoped, dataSourceId);
    const mappings = await this.dataSourceService.listMappings(scoped, dataSourceId, {
      page: '1',
      pageSize: '50',
    });
    const { credential, ...rest } = dataSource;
    return {
      dataSource: {
        ...rest,
        credential: credential
          ? { id: credential.id, provider: credential.provider, createdAt: credential.createdAt }
          : null,
      },
      mappings: mappings.items,
      connectorAvailable: sourceKindHasConnector(dataSource.type),
    };
  }

  async createDataSource(ctx: RequestContext, tenantId: string, raw: unknown) {
    const scoped = await this.operatorScope(ctx, tenantId);
    return this.dataSourceService.create(scoped, raw);
  }

  async updateDataSource(ctx: RequestContext, tenantId: string, dataSourceId: string, raw: unknown) {
    const scoped = await this.operatorScope(ctx, tenantId);
    return this.dataSourceService.update(scoped, dataSourceId, raw);
  }

  async removeDataSource(ctx: RequestContext, tenantId: string, dataSourceId: string) {
    const scoped = await this.operatorScope(ctx, tenantId);
    return this.dataSourceService.remove(scoped, dataSourceId);
  }

  async testDataSourceConnection(ctx: RequestContext, tenantId: string, dataSourceId: string) {
    const scoped = await this.operatorScope(ctx, tenantId);
    return this.dataSourceService.testConnection(scoped, dataSourceId);
  }

  async probeDataSourceConnection(ctx: RequestContext, tenantId: string, raw: unknown) {
    const scoped = await this.operatorScope(ctx, tenantId);
    return this.dataSourceService.probeConnection(scoped, raw);
  }

  async discoverDataSource(ctx: RequestContext, tenantId: string, dataSourceId: string) {
    const scoped = await this.operatorScope(ctx, tenantId);
    return this.dataSourceService.discover(scoped, dataSourceId);
  }

  async previewDataSource(ctx: RequestContext, tenantId: string, dataSourceId: string, raw: unknown) {
    const scoped = await this.operatorScope(ctx, tenantId);
    const input = previewQuerySchema.parse(raw ?? {});
    return this.dataSourceService.preview(scoped, dataSourceId, input.resource, input.limit);
  }

  async listMappings(ctx: RequestContext, tenantId: string, dataSourceId: string) {
    const scoped = await this.operatorScope(ctx, tenantId);
    return this.dataSourceService.listMappings(scoped, dataSourceId, { page: '1', pageSize: '50' });
  }

  async createMapping(ctx: RequestContext, tenantId: string, dataSourceId: string, raw: unknown) {
    const scoped = await this.operatorScope(ctx, tenantId);
    return this.dataSourceService.createMapping(scoped, dataSourceId, raw);
  }

  async updateMapping(
    ctx: RequestContext,
    tenantId: string,
    dataSourceId: string,
    mappingId: string,
    raw: unknown,
  ) {
    const scoped = await this.operatorScope(ctx, tenantId);
    return this.dataSourceService.updateMapping(scoped, dataSourceId, mappingId, raw);
  }

  async deleteMapping(ctx: RequestContext, tenantId: string, dataSourceId: string, mappingId: string) {
    const scoped = await this.operatorScope(ctx, tenantId);
    return this.dataSourceService.deleteMapping(scoped, dataSourceId, mappingId);
  }

  async createCredential(ctx: RequestContext, tenantId: string, raw: unknown) {
    const scoped = await this.operatorScope(ctx, tenantId);
    const credential = await this.credentialService.create(scoped, raw);
    return { id: credential.id, provider: credential.provider, createdAt: credential.createdAt };
  }

  async listCustomFields(ctx: RequestContext, tenantId: string, entityType?: string) {
    const scoped = await this.operatorScope(ctx, tenantId);
    return this.requireCustomFields().list(scoped, entityType);
  }

  async createCustomField(ctx: RequestContext, tenantId: string, raw: unknown) {
    const scoped = await this.operatorScope(ctx, tenantId);
    return this.requireCustomFields().create(scoped, raw);
  }

  async updateCustomField(ctx: RequestContext, tenantId: string, fieldId: string, raw: unknown) {
    const scoped = await this.operatorScope(ctx, tenantId);
    return this.requireCustomFields().update(scoped, fieldId, raw);
  }

  async deleteCustomField(ctx: RequestContext, tenantId: string, fieldId: string) {
    const scoped = await this.operatorScope(ctx, tenantId);
    return this.requireCustomFields().remove(scoped, fieldId);
  }

  private requireCustomFields(): CustomFieldDefinitionService {
    if (!this.customFields) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'Custom fields are not configured');
    }
    return this.customFields;
  }

  private async operatorScope(ctx: RequestContext, tenantId: string): Promise<RequestContext> {
    assertOperator(ctx);
    const tenant = await this.tenants.findByIdForOperator(tenantId);
    if (!tenant) throw new AppError(ErrorCode.NOT_FOUND, 'Tenant not found');
    return operatorTenantCtx(ctx, tenantId);
  }
}
