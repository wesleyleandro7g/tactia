import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  AuditLogRepository,
  CustomFieldDefinitionRepository,
  CustomerRepository,
  MembershipRepository,
  prisma,
  StructuredQueryRepository,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import { extractCustomData } from '@tactia/connectors';
import { ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { AuditAction, AuditLogService } from '../services/audit-log-service';
import { CustomDataValidationService } from '../services/custom-data-validation-service';
import { CustomFieldDefinitionService } from '../services/custom-field-definition-service';
import { CustomerService } from '../services/customer-service';
import { DataCatalogService } from '../services/data-catalog-service';
import { StructuredQueryService } from '../services/structured-query-service';
import { TenantService } from '../services/tenant-service';

const tenants = new TenantRepository(prisma);
const users = new UserRepository(prisma);
const memberships = new MembershipRepository(prisma);
const auditLogs = new AuditLogService(new AuditLogRepository(prisma));
const tenantService = new TenantService(tenants, memberships, auditLogs);
const definitions = new CustomFieldDefinitionRepository(prisma);
const catalog = new DataCatalogService(definitions);
const customFields = new CustomFieldDefinitionService(definitions, auditLogs, catalog);
const customData = new CustomDataValidationService(definitions);
const customers = new CustomerRepository(prisma);
const customerService = new CustomerService(customers, auditLogs, undefined, customData);
const structuredQuery = new StructuredQueryService(catalog, new StructuredQueryRepository(prisma));

const SLUGS = ['flex-a', 'flex-b'];

function context(
  partial: Partial<RequestContext> & Pick<RequestContext, 'tenantId' | 'userId' | 'role'>,
): RequestContext {
  return {
    requestId: createId(),
    ip: '127.0.0.1',
    ...partial,
  };
}

async function reset() {
  const tenantRows = await prisma.tenant.findMany({ where: { slug: { in: SLUGS } } });
  const ids = tenantRows.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.customFieldDefinition.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });
  }
  const authUsers = await prisma.authUser.findMany({
    where: { email: { in: ['owner@flex-a.test', 'member@flex-a.test', 'owner@flex-b.test'] } },
  });
  const authIds = authUsers.map((row) => row.id);
  if (authIds.length > 0) {
    await prisma.user.deleteMany({ where: { externalAuthId: { in: authIds } } });
    await prisma.authAccount.deleteMany({ where: { userId: { in: authIds } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: authIds } } });
    await prisma.authUser.deleteMany({ where: { id: { in: authIds } } });
  }
  if (ids.length > 0) {
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  }
}

async function setupTenant(slug: string, email: string) {
  const auth = await prisma.authUser.create({
    data: { id: createId(), name: slug, email, emailVerified: true },
  });
  const user = await users.create({
    externalAuthId: auth.id,
    name: slug,
    email,
  });
  const tenant = await tenantService.create(context({ tenantId: null, userId: user.id, role: null }), {
    name: slug,
    slug,
  });
  return {
    user,
    tenant,
    ctx: context({ tenantId: tenant.id, userId: user.id, role: 'owner' as const }),
  };
}

describe('flexible custom fields', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await reset();
    catalog.invalidate('unused');
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it('extracts custom: mapping targets from a normalized row', () => {
    expect(
      extractCustomData({
        name: 'Acme',
        'custom:equipment_type': 'compressor',
        'custom:': 'ignored',
        email: 'a@b.test',
      }),
    ).toEqual({ equipment_type: 'compressor' });
  });

  it('creates, lists, updates and deletes definitions with audit and catalog cache', async () => {
    const { ctx, tenant } = await setupTenant('flex-a', 'owner@flex-a.test');
    catalog.invalidate(tenant.id);

    const created = await customFields.create(ctx, {
      entityType: 'customer',
      fieldKey: 'equipment_type',
      label: 'Tipo de equipamento',
      fieldType: 'select',
      description: 'Linha do equipamento',
      config: { options: ['compressor', 'bomba'] },
    });
    expect(created.fieldKey).toBe('equipment_type');

    const listed = await customFields.list(ctx, 'customer');
    expect(listed.items).toHaveLength(1);

    const catalogAfterCreate = await catalog.getCatalog(ctx, { entityType: 'customer' });
    expect(catalogAfterCreate.entities[0]?.fields.some((field) => field.key === 'equipment_type')).toBe(
      true,
    );

    const updated = await customFields.update(ctx, created.id, { label: 'Tipo' });
    expect(updated.label).toBe('Tipo');

    await customFields.remove(ctx, created.id);
    expect((await customFields.list(ctx)).items).toHaveLength(0);

    const logs = await auditLogs.list({ tenantId: tenant.id, skip: 0, take: 20 });
    expect(logs.items.some((row) => row.action === AuditAction.CUSTOM_FIELD_CREATED)).toBe(true);
    expect(logs.items.some((row) => row.action === AuditAction.CUSTOM_FIELD_UPDATED)).toBe(true);
    expect(logs.items.some((row) => row.action === AuditAction.CUSTOM_FIELD_DELETED)).toBe(true);
  });

  it('rejects invalid keys, reserved canonical keys, unknown types and missing select options', async () => {
    const { ctx } = await setupTenant('flex-a', 'owner@flex-a.test');

    await expect(
      customFields.create(ctx, {
        entityType: 'customer',
        fieldKey: 'Nome',
        label: 'Nome extra',
        fieldType: 'text',
      }),
    ).rejects.toBeInstanceOf(ZodError);

    await expect(
      customFields.create(ctx, {
        entityType: 'customer',
        fieldKey: 'name',
        label: 'Nome extra',
        fieldType: 'text',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

    await expect(
      customFields.create(ctx, {
        entityType: 'customer',
        fieldKey: 'foo',
        label: 'Foo',
        fieldType: 'xml',
      }),
    ).rejects.toBeInstanceOf(ZodError);

    await expect(
      customFields.create(ctx, {
        entityType: 'customer',
        fieldKey: 'tier',
        label: 'Faixa',
        fieldType: 'select',
        config: { options: [] },
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it('rejects unknown custom_data keys and coerces defined types', async () => {
    const { ctx, tenant } = await setupTenant('flex-a', 'owner@flex-a.test');
    await customFields.create(ctx, {
      entityType: 'customer',
      fieldKey: 'estimated_hours',
      label: 'Horas',
      fieldType: 'number',
      config: { min: 0, max: 100 },
    });

    await expect(
      customerService.create(ctx, { name: 'Acme', customData: { unknown_field: 1 } }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });

    await expect(
      customerService.create(ctx, { name: 'Acme', customData: { estimated_hours: '8' } }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });

    const customer = await customerService.create(ctx, {
      name: 'Acme',
      customData: { estimated_hours: 8 },
    });
    expect(customer.customData).toEqual({ estimated_hours: 8 });

    const picked = await customData.pickValid(tenant.id, 'customer', {
      estimated_hours: '12',
      garbage: true,
    });
    expect(picked).toEqual({ estimated_hours: 12 });
  });

  it('isolates definitions and JSONB data between tenants', async () => {
    const a = await setupTenant('flex-a', 'owner@flex-a.test');
    const b = await setupTenant('flex-b', 'owner@flex-b.test');

    await customFields.create(a.ctx, {
      entityType: 'customer',
      fieldKey: 'equipment_type',
      label: 'Tipo',
      fieldType: 'text',
    });
    await customerService.create(a.ctx, {
      name: 'Acme A',
      customData: { equipment_type: 'compressor' },
    });

    expect((await customFields.list(b.ctx)).items).toHaveLength(0);
    const catalogB = await catalog.getCatalog(b.ctx, { entityType: 'customer' });
    expect(catalogB.entities[0]?.fields.some((field) => field.key === 'equipment_type')).toBe(false);

    await expect(
      customerService.create(b.ctx, { name: 'Acme B', customData: { equipment_type: 'compressor' } }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });

    const queryB = await structuredQuery.query(b.ctx, {
      entityType: 'customer',
      fields: ['name'],
      filters: [{ field: 'name', operator: 'eq', value: 'Acme A' }],
    });
    expect(queryB.rows).toHaveLength(0);
  });

  it('queries and aggregates custom fields and rejects unknown fields', async () => {
    const { ctx } = await setupTenant('flex-a', 'owner@flex-a.test');
    await customFields.create(ctx, {
      entityType: 'customer',
      fieldKey: 'equipment_type',
      label: 'Tipo',
      fieldType: 'text',
    });
    await customFields.create(ctx, {
      entityType: 'customer',
      fieldKey: 'estimated_hours',
      label: 'Horas',
      fieldType: 'number',
    });

    await customerService.create(ctx, {
      name: 'Alpha',
      customData: { equipment_type: 'compressor', estimated_hours: 10 },
    });
    await customerService.create(ctx, {
      name: 'Beta',
      customData: { equipment_type: 'bomba', estimated_hours: 4 },
    });
    await customerService.create(ctx, {
      name: 'Gamma',
      customData: { equipment_type: 'compressor', estimated_hours: 6 },
    });

    const queried = await structuredQuery.query(ctx, {
      entityType: 'customer',
      fields: ['name', 'equipment_type'],
      filters: [{ field: 'equipment_type', operator: 'eq', value: 'compressor' }],
    });
    expect(queried.rows).toHaveLength(2);
    expect(queried.meta.count).toBe(2);
    expect(queried.rows.map((row) => row.name).sort()).toEqual(['Alpha', 'Gamma']);

    await expect(
      structuredQuery.query(ctx, {
        entityType: 'customer',
        fields: ['nao_existe'],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });

    const aggregated = await structuredQuery.aggregate(ctx, {
      entityType: 'customer',
      metrics: [{ op: 'count' }, { op: 'sum', field: 'estimated_hours' }],
      groupBy: 'equipment_type',
    });
    const byType = Object.fromEntries(
      aggregated.metrics.map((row) => [String(row.equipment_type), row]),
    );
    expect(byType.compressor).toMatchObject({ count: 2, sum_estimated_hours: 16 });
    expect(byType.bomba).toMatchObject({ count: 1, sum_estimated_hours: 4 });
  });

  it('does not let a member mutate field definitions', async () => {
    const { tenant } = await setupTenant('flex-a', 'owner@flex-a.test');
    const memberAuth = await prisma.authUser.create({
      data: { id: createId(), name: 'member', email: 'member@flex-a.test', emailVerified: true },
    });
    const member = await users.create({
      externalAuthId: memberAuth.id,
      name: 'member',
      email: 'member@flex-a.test',
    });
    await memberships.create({ tenantId: tenant.id, userId: member.id, role: 'member' });
    const memberCtx = context({ tenantId: tenant.id, userId: member.id, role: 'member' });

    await expect(
      customFields.create(memberCtx, {
        entityType: 'customer',
        fieldKey: 'equipment_type',
        label: 'Tipo',
        fieldType: 'text',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHORIZATION_ERROR });
  });
});
