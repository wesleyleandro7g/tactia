import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ActivityRepository,
  AuditLogRepository,
  CampaignRepository,
  CustomerRepository,
  ExpenseRepository,
  InteractionRepository,
  InventoryLevelRepository,
  LeadRepository,
  MembershipRepository,
  prisma,
  PaymentRepository,
  ProductRepository,
  SaleRepository,
  SellerRepository,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import { createId, type RequestContext } from '@tactia/shared';
import { normalizeToCanonical } from '@tactia/connectors';
import { AuditLogService } from '../services/audit-log-service';
import { InteractionEnrichmentService } from '../services/interaction-enrichment-service';
import { InteractionService } from '../services/interaction-service';
import { TenantService } from '../services/tenant-service';

const tenants = new TenantRepository(prisma);
const users = new UserRepository(prisma);
const memberships = new MembershipRepository(prisma);
const customers = new CustomerRepository(prisma);
const interactions = new InteractionRepository(prisma);
const products = new ProductRepository(prisma);
const sellers = new SellerRepository(prisma);
const sales = new SaleRepository(prisma);
const leads = new LeadRepository(prisma);
const activities = new ActivityRepository(prisma);
const expenses = new ExpenseRepository(prisma);
const payments = new PaymentRepository(prisma);
const inventoryLevels = new InventoryLevelRepository(prisma);
const campaigns = new CampaignRepository(prisma);
const auditLogs = new AuditLogService(new AuditLogRepository(prisma));
const tenantService = new TenantService(tenants, memberships, auditLogs);

const unitVector = (index: number) => {
  const values = new Array<number>(1536).fill(0);
  values[index] = 1;
  return values;
};

const SLUGS = ['interaction-a', 'interaction-b'];

let tenantA: string;
let tenantB: string;
let customerA: string;
let ctxA: RequestContext;
let ctxB: RequestContext;

function ctx(tenantId: string, userId: string): RequestContext {
  return {
    requestId: createId(),
    tenantId,
    userId,
    role: 'owner',
    ip: '127.0.0.1',
  };
}

async function cleanUp() {
  const rows = await prisma.tenant.findMany({ where: { slug: { in: SLUGS } } });
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  await prisma.interaction.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });
  const authUsers = await prisma.authUser.findMany({
    where: { email: { endsWith: '@interaction.test' } },
  });
  const authIds = authUsers.map((row) => row.id);
  if (authIds.length > 0) {
    await prisma.user.deleteMany({ where: { externalAuthId: { in: authIds } } });
    await prisma.authUser.deleteMany({ where: { id: { in: authIds } } });
  }
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await cleanUp();
  const authA = await prisma.authUser.create({
    data: {
      id: createId(),
      name: 'A',
      email: 'a@interaction.test',
      emailVerified: true,
    },
  });
  const userA = await users.create({
    externalAuthId: authA.id,
    name: 'A',
    email: 'a@interaction.test',
  });
  const a = await tenantService.create(
    { requestId: createId(), userId: userA.id, ip: '127.0.0.1', tenantId: null, role: null },
    { name: 'Interaction A', slug: 'interaction-a' },
  );
  tenantA = a.id;
  ctxA = ctx(tenantA, userA.id);

  const authB = await prisma.authUser.create({
    data: {
      id: createId(),
      name: 'B',
      email: 'b@interaction.test',
      emailVerified: true,
    },
  });
  const userB = await users.create({
    externalAuthId: authB.id,
    name: 'B',
    email: 'b@interaction.test',
  });
  const b = await tenantService.create(
    { requestId: createId(), userId: userB.id, ip: '127.0.0.1', tenantId: null, role: null },
    { name: 'Interaction B', slug: 'interaction-b' },
  );
  tenantB = b.id;
  ctxB = ctx(tenantB, userB.id);

  customerA = (await customers.create({ tenantId: tenantA, name: 'Cliente A', email: 'a@ex.com' }))
    .id;
});

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

describe('InteractionService', () => {
  it('creates a note and lists it only for the owning tenant', async () => {
    const service = new InteractionService(interactions, customers, auditLogs);
    const created = await service.create(ctxA, {
      body: 'Cliente reclamou do atraso na entrega.',
      channel: 'note',
      customerId: customerA,
    });
    expect(created?.body).toMatch(/atraso/);

    const listed = await service.list(ctxA, { page: '1', pageSize: '20' });
    expect(listed.total).toBeGreaterThan(0);

    const other = await service.list(ctxB, { page: '1', pageSize: '20' });
    expect(other.total).toBe(0);
  });

  it('upserts by external id without duplicating', async () => {
    const first = await interactions.upsertByExternalId({
      tenantId: tenantA,
      dataSourceId: createId(),
      externalId: 'wa-1',
      channel: 'whatsapp',
      body: 'primeira',
      occurredAt: new Date('2025-01-01T12:00:00Z'),
    });
    const second = await interactions.upsertByExternalId({
      tenantId: tenantA,
      dataSourceId: first.entity.dataSourceId!,
      externalId: 'wa-1',
      channel: 'whatsapp',
      body: 'primeira',
      occurredAt: new Date('2025-01-01T12:00:00Z'),
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.entity.id).toBe(first.entity.id);
  });

  it('searchByEmbedding never leaks the neighbor tenant', async () => {
    const dataSourceA = createId();
    const dataSourceB = createId();
    const a = await interactions.upsertByExternalId({
      tenantId: tenantA,
      dataSourceId: dataSourceA,
      externalId: 'vec-a',
      channel: 'whatsapp',
      body: 'reclamação de atraso',
      occurredAt: new Date('2025-01-10T00:00:00Z'),
    });
    const b = await interactions.upsertByExternalId({
      tenantId: tenantB,
      dataSourceId: dataSourceB,
      externalId: 'vec-b',
      channel: 'whatsapp',
      body: 'reclamação de atraso no outro tenant',
      occurredAt: new Date('2025-01-10T00:00:00Z'),
    });
    await interactions.updateEnrichment({
      tenantId: tenantA,
      id: a.entity.id,
      intent: 'complaint',
      topics: ['atraso'],
      embedding: unitVector(0),
    });
    await interactions.updateEnrichment({
      tenantId: tenantB,
      id: b.entity.id,
      intent: 'complaint',
      topics: ['atraso'],
      embedding: unitVector(0),
    });

    const hits = await interactions.searchByEmbedding({
      tenantId: tenantA,
      embedding: unitVector(0),
      from: new Date('2025-01-01T00:00:00Z'),
      to: new Date('2025-02-01T00:00:00Z'),
      limit: 10,
    });
    expect(hits.every((hit) => hit.tenantId === tenantA)).toBe(true);
    expect(hits.some((hit) => hit.id === b.entity.id)).toBe(false);
  });

  it('normalizer upserts an interaction and skips rows without body', async () => {
    const dataSourceId = createId();
    const repos = {
      customers,
      products,
      sellers,
      sales,
      interactions,
      leads,
      activities,
      expenses,
      payments,
      inventoryLevels,
      campaigns,
    };
    const created = await normalizeToCanonical(
      tenantA,
      dataSourceId,
      'interaction',
      {
        external_id: 'wa-norm-1',
        body: 'O pedido atrasou',
        occurred_at: '2025-01-04T10:00:00Z',
        channel: 'whatsapp',
        customer_email: 'a@ex.com',
      },
      repos,
    );
    expect(created.status).toBe('created');

    const skipped = await normalizeToCanonical(
      tenantA,
      dataSourceId,
      'interaction',
      { external_id: 'wa-norm-2', occurred_at: '2025-01-04T10:00:00Z' },
      repos,
    );
    expect(skipped).toMatchObject({ status: 'skipped', reason: 'interaction_without_body' });
  });

  it('enrichment failure does not throw', async () => {
    const enrichment = new InteractionEnrichmentService({
      interactions,
      classifier: {
        async classify() {
          throw new Error('llm down');
        },
      },
      embedder: {
        async embed() {
          throw new Error('embed down');
        },
      },
    });
    const pending = await enrichment.enrichPending({ tenantId: tenantA });
    expect(pending).toBe(0);
  });
});
