/**
 * Intelligence Pipeline integration tests.
 *
 * Validates:
 * - RuleEngine detects revenue_drop anomaly from the seed-like dataset
 * - InsightEngine persists insights with deduplication (run 2x → same count)
 * - RecommendationEngine creates linked recommendation
 * - InactiveLeads rule detects leads without recent activity
 *
 * Env: DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CustomerRepository,
  InsightRepository,
  LeadRepository,
  prisma,
  RecommendationRepository,
  SaleRepository,
  TenantRepository,
} from '@tactia/database';
import { MetricEngine, RuleEngine, InsightEngine, RecommendationEngine, DEFAULT_THRESHOLDS } from '../index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tenants = new TenantRepository(prisma);
const customers = new CustomerRepository(prisma);
const sales = new SaleRepository(prisma);
const leads = new LeadRepository(prisma);
const insightRepo = new InsightRepository(prisma);
const recommendationRepo = new RecommendationRepository(prisma);

const metricEngine = new MetricEngine(prisma);
const ruleEngine = new RuleEngine(metricEngine);
const insightEngine = new InsightEngine(insightRepo);
const recommendationEngine = new RecommendationEngine(recommendationRepo, insightRepo);

let tenantId: string;
let otherTenantId: string;
let customerId: string;

// Analysis period: Jan 2025
const periodTo = new Date('2025-02-01T00:00:00Z');
const periodFrom = new Date('2025-01-01T00:00:00Z'); // 31 days
// Previous period (Dec 2024 — same duration)
// revenue in Dec will be much higher to force a drop in Jan

async function cleanUp() {
  // Scoped cleanup — only delete this test's tenants (by slug) to avoid
  // cross-package conflicts when tests run in parallel on the shared test DB.
  const testSlugs = ['intel-test', 'other-intel-test'];
  const tenantRows = await prisma.tenant.findMany({ where: { slug: { in: testSlugs } } });
  const ids = tenantRows.map((t) => t.id);
  if (ids.length === 0) return;

  await prisma.recommendation.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.insight.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.saleItem.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.sale.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.activity.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.lead.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.metric.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await cleanUp();

  const tenant = await tenants.create({ name: 'Intelligence Test', slug: 'intel-test' });
  tenantId = tenant.id;

  const other = await tenants.create({ name: 'Other Tenant', slug: 'other-intel-test' });
  otherTenantId = other.id;

  customerId = (await customers.create({ tenantId, name: 'TestCustomer' })).id;

  // Dec 2024: high revenue (1000)
  await sales.create({
    tenantId,
    customerId,
    totalAmount: 1000,
    soldAt: new Date('2024-12-15T00:00:00Z'),
    items: [],
  });

  // Jan 2025: low revenue (100) → drop of -90%
  await sales.create({
    tenantId,
    customerId,
    totalAmount: 100,
    soldAt: new Date('2025-01-15T00:00:00Z'),
    items: [],
  });

  // Lead without any activity (inactive_leads rule)
  await leads.create({ tenantId, name: 'Stale Lead', status: 'contacted' });
});

afterAll(async () => {
  await cleanUp();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RuleEngine', () => {
  it('detects revenue_drop anomaly when revenue falls > 15%', async () => {
    const events = await ruleEngine.evaluate({
      tenantId,
      period: { from: periodFrom, to: periodTo },
      db: prisma,
      thresholds: DEFAULT_THRESHOLDS,
    });

    const drop = events.find((e) => e.ruleKey === 'revenue_drop');
    expect(drop).toBeDefined();
    expect(drop!.type).toBe('anomaly');
    expect(drop!.severity).toBe('critical'); // -90% > 30%
    expect(drop!.evidence.length).toBeGreaterThan(0);
  });

  it('reports the real drop percentage (1000 → 100 = 90%)', async () => {
    const events = await ruleEngine.evaluate({
      tenantId,
      period: { from: periodFrom, to: periodTo },
      db: prisma,
      thresholds: DEFAULT_THRESHOLDS,
    });

    const drop = events.find((e) => e.ruleKey === 'revenue_drop')!;
    // Regression: reading `comparison.change` of a growth metric compared
    // growth to growth and reported 190% instead of 90%.
    expect(drop.title).toBe('Queda de receita de 90%');
    expect(drop.description).toContain('90%');

    const growth = drop.evidence.find((item) => item.key === 'revenue_growth')!;
    expect(growth.value).toBeCloseTo(-0.9, 5);

    // Revenue with comparison is part of the evidence: R$ 100 vs R$ 1.000.
    const revenue = drop.evidence.find((item) => item.key === 'revenue')!;
    expect(revenue.value).toBe(100);
    expect(revenue.comparison?.value).toBe(1000);
  });

  it('detects inactive_leads rule', async () => {
    const events = await ruleEngine.evaluate({
      tenantId,
      period: { from: periodFrom, to: periodTo },
      db: prisma,
      thresholds: DEFAULT_THRESHOLDS,
    });

    const inactive = events.find((e) => e.ruleKey === 'inactive_leads');
    expect(inactive).toBeDefined();
    expect(inactive!.type).toBe('opportunity');
    expect(inactive!.evidence[0]!.value).toBeGreaterThanOrEqual(1);
  });

  it('does NOT leak events from other tenant', async () => {
    const events = await ruleEngine.evaluate({
      tenantId: otherTenantId,
      period: { from: periodFrom, to: periodTo },
      db: prisma,
      thresholds: DEFAULT_THRESHOLDS,
    });

    // No sales in otherTenant → no revenue_drop (no previous revenue to drop from)
    const drop = events.find((e) => e.ruleKey === 'revenue_drop');
    expect(drop).toBeUndefined();
  });
});

describe('InsightEngine — deduplication', () => {
  it('creates insight on first run', async () => {
    const events = await ruleEngine.evaluate({
      tenantId,
      period: { from: periodFrom, to: periodTo },
      db: prisma,
      thresholds: DEFAULT_THRESHOLDS,
    });

    const created = await insightEngine.processEvents(tenantId, events);
    expect(created.length).toBeGreaterThan(0);

    const list = await insightRepo.list({ tenantId });
    expect(list.total).toBe(created.length);
  });

  it('does NOT create duplicate insights on second run', async () => {
    const before = (await insightRepo.list({ tenantId })).total;

    const events = await ruleEngine.evaluate({
      tenantId,
      period: { from: periodFrom, to: periodTo },
      db: prisma,
      thresholds: DEFAULT_THRESHOLDS,
    });
    await insightEngine.processEvents(tenantId, events);

    const after = (await insightRepo.list({ tenantId })).total;
    expect(after).toBe(before); // no new insights
  });

  it('insight evidence contains MetricResult with ruleKey-relevant data', async () => {
    const list = await insightRepo.list({ tenantId });
    const drop = list.items.find((i) => i.ruleKey === 'revenue_drop');
    expect(drop).toBeDefined();
    expect(drop!.evidence).toBeTruthy();
    // evidence is stored as JSON array of MetricResult-like objects
    const evidence = drop!.evidence as Array<{ key: string }>;
    expect(Array.isArray(evidence)).toBe(true);
    expect(evidence.some((e) => e.key === 'revenue_growth')).toBe(true);
  });
});

describe('RecommendationEngine', () => {
  it('generates recommendations for created insights', async () => {
    const insightList = await insightRepo.list({ tenantId });
    const insightIds = insightList.items.map((i) => i.id);

    const beforeCount = (await recommendationRepo.list({ tenantId })).total;
    await recommendationEngine.generateForInsights(tenantId, insightIds);
    const afterCount = (await recommendationRepo.list({ tenantId })).total;

    expect(afterCount).toBeGreaterThan(beforeCount);
  });

  it('does NOT create duplicate recommendations on second call', async () => {
    const insightList = await insightRepo.list({ tenantId });
    const insightIds = insightList.items.map((i) => i.id);

    const before = (await recommendationRepo.list({ tenantId })).total;
    await recommendationEngine.generateForInsights(tenantId, insightIds);
    const after = (await recommendationRepo.list({ tenantId })).total;

    expect(after).toBe(before);
  });

  it('recommendation for revenue_drop has priority=high', async () => {
    const drop = (await insightRepo.list({ tenantId })).items.find(
      (i) => i.ruleKey === 'revenue_drop',
    );
    expect(drop).toBeDefined();

    const recList = await recommendationRepo.list({ tenantId });
    const rec = recList.items.find((r) => r.insightId === drop!.id);
    expect(rec).toBeDefined();
    expect(rec!.priority).toBe('high');
    expect(rec!.status).toBe('pending');
  });
});
