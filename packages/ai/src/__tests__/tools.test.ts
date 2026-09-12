/**
 * Integration tests for the 6 V0.1 tools against a real Postgres.
 *
 * Proves that:
 * - every tool returns real, deterministic numbers from the domain services
 * - every numeric result carries citable evidence (`sources`)
 * - a tool executed with another tenant's context sees nothing (spec §34)
 *
 * Env: DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuditLogRepository,
  CustomerRepository,
  InsightRepository,
  InteractionRepository,
  LeadRepository,
  MembershipRepository,
  MetricRepository,
  prisma,
  ProductRepository,
  RecommendationRepository,
  SaleRepository,
  SellerRepository,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import {
  AuditLogService,
  AnalyticsService,
  CustomerService,
  InsightService,
  InteractionService,
  MetricService,
  ProductService,
  RecommendationService,
  SaleService,
  SellerService,
  TenantService,
} from '@tactia/domain';
import { MetricEngine } from '@tactia/intelligence';
import { ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { ContextBuilder } from '../context-builder';
import { MockEmbeddingAdapter } from '../embeddings/mock-embedding-adapter';
import { createDefaultToolRegistry } from '../tools/index';
import type { ToolContext } from '../types';

// ---------------------------------------------------------------------------
// Wiring (same services used by the REST API)
// ---------------------------------------------------------------------------

const tenants = new TenantRepository(prisma);
const users = new UserRepository(prisma);
const memberships = new MembershipRepository(prisma);
const auditLogs = new AuditLogService(new AuditLogRepository(prisma));
const insightRepository = new InsightRepository(prisma);

const tenantService = new TenantService(tenants, memberships, auditLogs);
const metricService = new MetricService(new MetricEngine(prisma), new MetricRepository(prisma));
const analyticsService = new AnalyticsService(prisma);
const customerService = new CustomerService(new CustomerRepository(prisma), auditLogs);
const productService = new ProductService(new ProductRepository(prisma), auditLogs);
const sellerService = new SellerService(new SellerRepository(prisma), auditLogs);
const saleService = new SaleService(
  new SaleRepository(prisma),
  new CustomerRepository(prisma),
  new ProductRepository(prisma),
  new SellerRepository(prisma),
  auditLogs,
);
const interactionRepository = new InteractionRepository(prisma);
const interactionService = new InteractionService(
  interactionRepository,
  new CustomerRepository(prisma),
  auditLogs,
);
const insightService = new InsightService(insightRepository);
const recommendationService = new RecommendationService(
  new RecommendationRepository(prisma),
  auditLogs,
);

const registry = createDefaultToolRegistry({
  metrics: metricService,
  analytics: analyticsService,
  customers: customerService,
  products: productService,
  sellers: sellerService,
  sales: saleService,
  insights: insightService,
  recommendations: recommendationService,
  interactions: interactionService,
  embedder: new MockEmbeddingAdapter(),
});

const contextBuilder = new ContextBuilder({
  tenants: tenantService,
  metrics: metricService,
  insights: insightService,
});

// ---------------------------------------------------------------------------
// Fixtures — Jan/2025 with a 50% revenue drop vs Dec/2024
// ---------------------------------------------------------------------------

const PERIOD = { from: '2025-01-01T00:00:00.000Z', to: '2025-02-01T00:00:00.000Z' };
const TEST_SLUGS = ['ai-tools-co', 'ai-other-co'];

const salesRepository = new SaleRepository(prisma);
const customersRepository = new CustomerRepository(prisma);
const leadsRepository = new LeadRepository(prisma);

let ctxA: ToolContext;
let ctxB: ToolContext;
let insightId: string;

function toolContext(partial: Pick<RequestContext, 'tenantId' | 'userId' | 'role'>): ToolContext {
  return {
    requestId: createId(),
    ip: '127.0.0.1',
    ...partial,
  } as ToolContext;
}

async function cleanUp() {
  const rows = await prisma.tenant.findMany({ where: { slug: { in: TEST_SLUGS } } });
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;

  await prisma.interaction.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.message.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.recommendation.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.insight.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.saleItem.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.sale.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.activity.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.lead.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.seller.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.metric.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });

  const authUsers = await prisma.authUser.findMany({ where: { email: { endsWith: '@ai-tools.local' } } });
  const authIds = authUsers.map((row) => row.id);
  if (authIds.length > 0) {
    await prisma.user.deleteMany({ where: { externalAuthId: { in: authIds } } });
    await prisma.authUser.deleteMany({ where: { id: { in: authIds } } });
  }
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

async function setupTenant(slug: string) {
  const auth = await prisma.authUser.create({
    data: { id: createId(), name: slug, email: `${slug}@ai-tools.local`, emailVerified: true },
  });
  const user = await users.create({
    externalAuthId: auth.id,
    name: slug,
    email: `${slug}@ai-tools.local`,
  });
  const tenant = await tenants.create({ name: slug, slug });
  await memberships.create({ tenantId: tenant.id, userId: user.id, role: 'owner' });
  return { tenant, ctx: toolContext({ tenantId: tenant.id, userId: user.id, role: 'owner' }) };
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanUp();

  const a = await setupTenant('ai-tools-co');
  const b = await setupTenant('ai-other-co');
  ctxA = a.ctx;
  ctxB = b.ctx;

  const tenantId = a.tenant.id;

  const customer = await customersRepository.create({ tenantId, name: 'Cliente Alfa' });
  const otherCustomer = await customersRepository.create({ tenantId, name: 'Cliente Beta' });
  await leadsRepository.create({ tenantId, name: 'Lead Gama', status: 'new' });

  const productPro = await prisma.product.create({
    data: { id: createId(), tenantId, name: 'Plano Pro', price: 600 },
  });
  const productLite = await prisma.product.create({
    data: { id: createId(), tenantId, name: 'Plano Lite', price: 200 },
  });
  const sellerAna = await prisma.seller.create({
    data: { id: createId(), tenantId, name: 'Ana Vendas' },
  });
  const sellerBruno = await prisma.seller.create({
    data: { id: createId(), tenantId, name: 'Bruno Vendas' },
  });

  // Dec/2024 — previous period: 2000
  await salesRepository.create({
    tenantId,
    customerId: customer.id,
    sellerId: sellerAna.id,
    totalAmount: 2000,
    soldAt: new Date('2024-12-10T00:00:00Z'),
    items: [],
  });

  // Jan/2025 — current period: 600 + 200 + 200 = 1000 (50% drop)
  await salesRepository.create({
    tenantId,
    customerId: customer.id,
    sellerId: sellerAna.id,
    totalAmount: 600,
    soldAt: new Date('2025-01-05T00:00:00Z'),
    items: [{ productId: productPro.id, quantity: 1, unitPrice: 600, totalAmount: 600 }],
  });
  await salesRepository.create({
    tenantId,
    customerId: otherCustomer.id,
    sellerId: sellerBruno.id,
    totalAmount: 200,
    soldAt: new Date('2025-01-10T00:00:00Z'),
    items: [{ productId: productLite.id, quantity: 1, unitPrice: 200, totalAmount: 200 }],
  });
  await salesRepository.create({
    tenantId,
    customerId: otherCustomer.id,
    sellerId: sellerBruno.id,
    totalAmount: 200,
    soldAt: new Date('2025-01-20T00:00:00Z'),
    items: [{ productId: productLite.id, quantity: 1, unitPrice: 200, totalAmount: 200 }],
  });
  // Cancelled sale must be ignored everywhere
  await salesRepository.create({
    tenantId,
    customerId: customer.id,
    sellerId: sellerAna.id,
    totalAmount: 9999,
    status: 'cancelled',
    soldAt: new Date('2025-01-25T00:00:00Z'),
    items: [],
  });

  const insight = await insightRepository.create({
    tenantId,
    type: 'anomaly',
    severity: 'high',
    title: 'Queda de receita de 50%',
    description: 'A receita caiu 50% em relação ao período anterior.',
    ruleKey: 'revenue_drop',
    evidence: [
      {
        key: 'revenue_growth',
        value: -0.5,
        period: PERIOD,
        comparison: { value: 2000, period: PERIOD, change: -0.5, direction: 'down' },
      },
    ],
    periodFrom: new Date(PERIOD.from),
    periodTo: new Date(PERIOD.to),
  });
  insightId = insight.id;

  // Other tenant: revenue in the same period that must never leak
  const otherCustomerB = await customersRepository.create({
    tenantId: b.tenant.id,
    name: 'Cliente do Outro Tenant',
  });
  await salesRepository.create({
    tenantId: b.tenant.id,
    customerId: otherCustomerB.id,
    totalAmount: 77777,
    soldAt: new Date('2025-01-15T00:00:00Z'),
    items: [],
  });

  const complaint = await interactionRepository.create({
    tenantId,
    customerId: customer.id,
    channel: 'whatsapp',
    direction: 'inbound',
    body: 'Péssimo atendimento, o pedido atrasou e vou cancelar.',
    occurredAt: new Date('2025-01-12T14:00:00Z'),
    intent: 'complaint',
    topics: ['atraso'],
  });
  await interactionRepository.updateEnrichment({
    tenantId,
    id: complaint.id,
    intent: 'complaint',
    topics: ['atraso'],
    embedding: (await new MockEmbeddingAdapter().embed([complaint.body]))[0]!,
  });
  const praise = await interactionRepository.create({
    tenantId,
    customerId: otherCustomer.id,
    channel: 'email',
    direction: 'inbound',
    body: 'Excelente, obrigado pelo suporte rápido.',
    occurredAt: new Date('2025-01-18T10:00:00Z'),
    intent: 'praise',
    topics: ['elogio'],
  });
  await interactionRepository.updateEnrichment({
    tenantId,
    id: praise.id,
    intent: 'praise',
    topics: ['elogio'],
    embedding: (await new MockEmbeddingAdapter().embed([praise.body]))[0]!,
  });
  await interactionRepository.create({
    tenantId: b.tenant.id,
    channel: 'whatsapp',
    body: 'Péssimo, vou cancelar tudo neste tenant vizinho.',
    occurredAt: new Date('2025-01-12T14:00:00Z'),
    intent: 'complaint',
    topics: ['vizinho'],
  });
});

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

describe('V0.1 tools', () => {
  it('registers the read tools plus analytics tools', () => {
    expect(registry.names().sort()).toEqual(expect.arrayContaining([
      'compare_periods',
      'explain_change',
      'get_insight_detail',
      'get_trend',
      'get_complaints',
      'get_customer_profile',
      'get_customer_segments',
      'get_customer_voice',
      'get_customers',
      'get_data_freshness',
      'get_forecast',
      'get_funnel',
      'get_goals_progress',
      'get_insights',
      'get_inventory_risk',
      'get_latest_briefing',
      'get_period_projection',
      'get_pipeline',
      'get_profitability',
      'get_rfm',
      'get_cohorts',
      'get_cash_flow',
      'get_acquisition',
      'simulate',
      'remember_fact',
      'list_business_facts',
      'search_business_facts',
      'search_episodes',
      'list_playbooks',
      'get_playbook',
      'get_product_affinity',
      'get_product_performance',
      'get_products',
      'get_revenue',
      'get_sales',
      'get_sales_health',
      'get_seller_performance',
      'get_sellers',
      'search_interactions',
    ]));
    expect(registry.has('propose_action')).toBe(false);
  });

  it('get_revenue returns the exact revenue with comparison and evidence', async () => {
    const result = await registry.execute('get_revenue', ctxA, {
      from: PERIOD.from,
      to: PERIOD.to,
    });
    const data = result.data as {
      value: number;
      period: { from: string; to: string };
      comparison?: { value: number; change: number; direction: string };
    };

    expect(data.value).toBe(1000);
    expect(data.comparison?.value).toBe(2000);
    expect(data.comparison?.change).toBeCloseTo(-0.5, 5);
    expect(data.comparison?.direction).toBe('down');

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({ metric: 'revenue', tool: 'get_revenue' });
    expect(result.sources[0]?.period?.from).toBe(PERIOD.from);
  });

  it('get_revenue groups by seller when asked', async () => {
    const result = await registry.execute('get_revenue', ctxA, {
      from: PERIOD.from,
      to: PERIOD.to,
      groupBy: 'seller',
    });
    const data = result.data as {
      breakdown?: { items: Array<{ label?: string; value: number }> };
    };
    expect(data.breakdown?.items?.[0]).toMatchObject({ label: 'Ana Vendas', value: 600 });
  });

  it('get_sales returns count, average ticket and growth with evidence', async () => {
    const result = await registry.execute('get_sales', ctxA, {
      from: PERIOD.from,
      to: PERIOD.to,
      recentSalesLimit: 2,
    });
    const data = result.data as {
      salesCount: { value: number };
      averageTicket: { value: number };
      salesGrowth: { value: number };
      recentSales?: unknown[];
    };

    expect(data.salesCount.value).toBe(3);
    expect(data.averageTicket.value).toBeCloseTo(1000 / 3, 5);
    expect(data.salesGrowth.value).toBeCloseTo(2, 5); // 1 → 3 sales
    expect(data.recentSales).toHaveLength(2);

    expect(result.sources.map((source) => source.metric)).toEqual([
      'sales_count',
      'average_ticket',
      'sales_growth',
    ]);
  });

  it('get_products ranks products by revenue', async () => {
    const result = await registry.execute('get_products', ctxA, {
      from: PERIOD.from,
      to: PERIOD.to,
    });
    const data = result.data as {
      totalProducts: number;
      ranking: Array<{ position: number; name: string; revenue: number }>;
    };

    expect(data.totalProducts).toBe(2);
    expect(data.ranking[0]).toMatchObject({ position: 1, name: 'Plano Pro', revenue: 600 });
    expect(data.ranking[1]).toMatchObject({ name: 'Plano Lite', revenue: 400 });
    expect(result.sources[0]).toMatchObject({ metric: 'revenue', tool: 'get_products' });
  });

  it('get_sellers ranks sellers by revenue', async () => {
    const result = await registry.execute('get_sellers', ctxA, {
      from: PERIOD.from,
      to: PERIOD.to,
    });
    const data = result.data as {
      totalSellers: number;
      averageRevenuePerSeller: number;
      ranking: Array<{ name: string; revenue: number }>;
    };

    expect(data.totalSellers).toBe(2);
    expect(data.ranking[0]).toMatchObject({ name: 'Ana Vendas', revenue: 600 });
    expect(data.averageRevenuePerSeller).toBe(500);
  });

  it('get_customers returns unique buyers of the period and the customer list', async () => {
    const result = await registry.execute('get_customers', ctxA, {
      from: PERIOD.from,
      to: PERIOD.to,
      limit: 10,
    });
    const data = result.data as {
      customerCount: { value: number };
      totalRegistered: number;
      customers: Array<{ name: string }>;
    };

    expect(data.customerCount.value).toBe(2);
    expect(data.totalRegistered).toBe(2);
    expect(data.customers.map((customer) => customer.name).sort()).toEqual([
      'Cliente Alfa',
      'Cliente Beta',
    ]);
    expect(result.sources[0]).toMatchObject({ metric: 'customer_count' });
  });

  it('get_insights returns open insights with their metric evidence', async () => {
    const result = await registry.execute('get_insights', ctxA, {});
    const data = result.data as {
      total: number;
      insights: Array<{
        id: string;
        ruleKey: string;
        severity: string;
        evidence: Array<{ metric: string; value: number }>;
      }>;
    };

    expect(data.total).toBe(1);
    expect(data.insights[0]?.id).toBe(insightId);
    expect(data.insights[0]?.ruleKey).toBe('revenue_drop');
    expect(data.insights[0]?.evidence[0]).toMatchObject({ metric: 'revenue_growth', value: -0.5 });

    // Evidence of the insight becomes evidence of the answer
    expect(result.sources.some((source) => source.metric === 'revenue_growth')).toBe(true);
    expect(result.sources.some((source) => source.metric === 'insights')).toBe(true);
  });

  it('get_complaints returns only complaint interactions with excerpts', async () => {
    const result = await registry.execute('get_complaints', ctxA, {
      from: PERIOD.from,
      to: PERIOD.to,
    });
    const data = result.data as {
      total: number;
      complaints: Array<{ excerpt: string; channel: string }>;
    };
    expect(data.total).toBe(1);
    expect(data.complaints).toHaveLength(1);
    expect(data.complaints[0]?.excerpt).toMatch(/atrasou/i);
    expect(result.sources.some((source) => source.excerpt)).toBe(true);
  });

  it('search_interactions finds complaints by meaning and stays in-tenant', async () => {
    const result = await registry.execute('search_interactions', ctxA, {
      query: 'cliente reclamou de atraso na entrega',
      from: PERIOD.from,
      to: PERIOD.to,
    });
    const data = result.data as { matches: Array<{ excerpt: string }>; mode: string };
    expect(data.mode).toBe('semantic');
    expect(data.matches.length).toBeGreaterThan(0);
    expect(data.matches.some((match) => /atrasou|cancelar/i.test(match.excerpt))).toBe(true);

    const other = await registry.execute('get_complaints', ctxB, {
      from: PERIOD.from,
      to: PERIOD.to,
    });
    const otherData = other.data as { total: number; complaints: Array<{ excerpt: string }> };
    expect(otherData.total).toBe(1);
    expect(otherData.complaints[0]?.excerpt).toMatch(/tenant vizinho/i);
  });

  it('get_customer_profile returns LTV and interactions for a known customer', async () => {
    const customers = await registry.execute('get_customers', ctxA, {
      from: PERIOD.from,
      to: PERIOD.to,
      limit: 1,
    });
    const customerId = (customers.data as { customers: Array<{ id: string }> }).customers[0]?.id;
    expect(customerId).toBeTruthy();

    const result = await registry.execute('get_customer_profile', ctxA, {
      customerId,
      from: PERIOD.from,
      to: PERIOD.to,
    });
    const data = result.data as {
      found: boolean;
      lifetime: { ltv: number; totalSales: number };
      interactions: Array<{ excerpt: string }>;
    };
    expect(data.found).toBe(true);
    expect(data.lifetime.ltv).toBeGreaterThan(0);
    expect(data.lifetime.totalSales).toBeGreaterThan(0);
    expect(result.sources[0]?.metric).toBe('customer_profile');
  });

  it('get_pipeline summarizes lead funnel', async () => {
    const result = await registry.execute('get_pipeline', ctxA, {});
    const data = result.data as { totals: { leads: number } };
    expect(data.totals.leads).toBeGreaterThanOrEqual(1);
  });

  it('get_period_projection returns linear projection', async () => {
    const result = await registry.execute('get_period_projection', ctxA, {
      from: PERIOD.from,
      to: PERIOD.to,
    });
    const data = result.data as {
      current: { revenue: number };
      projection: { revenueLinear: number };
    };
    expect(data.current.revenue).toBe(1000);
    expect(data.projection.revenueLinear).toBeGreaterThanOrEqual(data.current.revenue);
  });

  it('get_sales_health includes cancellation and discount metrics', async () => {
    const result = await registry.execute('get_sales_health', ctxA, {
      from: PERIOD.from,
      to: PERIOD.to,
    });
    const data = result.data as { metrics: Record<string, { key: string }> };
    expect(data.metrics.cancellation_rate).toBeDefined();
    expect(data.metrics.discount_total).toBeDefined();
    expect(result.sources.some((source) => source.metric === 'cancellation_rate')).toBe(true);
  });

  it('get_customer_voice summarizes intents and channels', async () => {
    const result = await registry.execute('get_customer_voice', ctxA, {
      from: PERIOD.from,
      to: PERIOD.to,
    });
    const data = result.data as { totals: { complaints: number; praise: number } };
    expect(data.totals.complaints).toBe(1);
    expect(data.totals.praise).toBe(1);
  });

  it('isolates tenants: the other tenant sees none of this data', async () => {
    const revenue = await registry.execute('get_revenue', ctxB, {
      from: PERIOD.from,
      to: PERIOD.to,
    });
    expect((revenue.data as { value: number }).value).toBe(77777);

    const products = await registry.execute('get_products', ctxB, {
      from: PERIOD.from,
      to: PERIOD.to,
    });
    expect((products.data as { ranking: unknown[] }).ranking).toHaveLength(0);

    const sellers = await registry.execute('get_sellers', ctxB, {
      from: PERIOD.from,
      to: PERIOD.to,
    });
    expect((sellers.data as { totalSellers: number }).totalSellers).toBe(0);

    const insights = await registry.execute('get_insights', ctxB, {});
    expect((insights.data as { total: number }).total).toBe(0);

    const customers = await registry.execute('get_customers', ctxB, {
      from: PERIOD.from,
      to: PERIOD.to,
    });
    const customerData = customers.data as { customers: Array<{ name: string }> };
    expect(customerData.customers.map((customer) => customer.name)).toEqual([
      'Cliente do Outro Tenant',
    ]);
  });

  it('rejects a tool call without an active tenant', async () => {
    const anonymous = toolContext({ tenantId: null, userId: null, role: null });
    await expect(registry.execute('get_revenue', anonymous, {})).rejects.toMatchObject({
      code: ErrorCode.AUTHENTICATION_ERROR,
    });
  });

  it('rejects invalid tool input with VALIDATION_ERROR', async () => {
    await expect(registry.execute('get_products', ctxA, { limit: 500 })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
    });
    await expect(
      registry.execute('get_revenue', ctxA, { from: '2025-02-01', to: '2025-01-01' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it('ContextBuilder assembles company, metrics, insights and evidence', async () => {
    const context = await contextBuilder.build(ctxA, {
      period: { from: new Date(PERIOD.from), to: new Date(PERIOD.to) },
    });

    expect(context.company.name).toBe('ai-tools-co');
    expect(context.company.currency).toBe('BRL');
    expect(context.metrics.find((metric) => metric.key === 'revenue')?.value).toBe(1000);
    expect(context.metrics.find((metric) => metric.key === 'sales_count')?.value).toBe(3);
    expect(context.insights[0]?.ruleKey).toBe('revenue_drop');
    // MTD + trailing-30 sources for every context metric
    expect(context.sources.length).toBe(context.metrics.length + context.trailing30.length);
    expect(context.trailing30.find((metric) => metric.key === 'revenue')).toBeDefined();
    expect(context.company.daysLeftInMonth).toBeGreaterThan(0);
    expect(context.sources.every((source) => source.tool === 'context')).toBe(true);
  });
});
