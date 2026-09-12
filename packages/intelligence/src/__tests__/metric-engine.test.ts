/**
 * MetricEngine integration tests.
 *
 * Uses the real Postgres test database (tactia_test) and a controlled dataset
 * so that every assertion checks an exact computed value.
 *
 * Env: DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CustomerRepository,
  prisma,
  ProductRepository,
  SaleRepository,
  SellerRepository,
  TenantRepository,
} from '@tactia/database';
import { MetricEngine } from '../metric-engine';
import { METRIC_KEYS } from '../types';

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

const tenants = new TenantRepository(prisma);
const customers = new CustomerRepository(prisma);
const products = new ProductRepository(prisma);
const sellers = new SellerRepository(prisma);
const sales = new SaleRepository(prisma);

const engine = new MetricEngine(prisma);

let tenantId: string;
let customerId1: string;
let customerId2: string;
let customerId3: string;
let productId: string;
let sellerId: string;

// Reference period: Jan 2025
const periodJan: { from: Date; to: Date } = {
  from: new Date('2025-01-01T00:00:00Z'),
  to: new Date('2025-02-01T00:00:00Z'),
};

// Previous period: Dec 2024 (same 31-day span)
// Used to validate comparison; the engine calculates it automatically.

async function cleanUp() {
  // Scoped cleanup by slug to avoid cross-package conflicts on the shared test DB.
  const tenantRows = await prisma.tenant.findMany({ where: { slug: 'metric-test' } });
  const ids = tenantRows.map((t) => t.id);
  if (ids.length === 0) return;

  await prisma.recommendation.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.insight.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.saleItem.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.sale.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.seller.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.metric.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await cleanUp();

  // Create tenant
  const tenant = await tenants.create({ name: 'Metric Test Tenant', slug: 'metric-test' });
  tenantId = tenant.id;

  // Create customers
  customerId1 = (await customers.create({ tenantId, name: 'Alice' })).id;
  customerId2 = (await customers.create({ tenantId, name: 'Bob' })).id;
  customerId3 = (await customers.create({ tenantId, name: 'Carol' })).id;

  // Create product
  productId = (
    await products.create({
      tenantId,
      name: 'Widget',
      price: 100,
    })
  ).id;

  // Create seller
  sellerId = (await sellers.create({ tenantId, name: 'Dave' })).id;

  // -------------------------------------------------------------------------
  // Sales in Jan 2025 (current period)
  //   Alice: 2 sales   → 100 + 200 = 300
  //   Bob:   1 sale    → 150
  //   Carol: 1 sale    → 250
  //   Total revenue: 700  |  sales_count: 4  |  customers: 3
  //   average_ticket: 700/4 = 175
  //   cancelled sale (should NOT count): 999
  // -------------------------------------------------------------------------
  await sales.create({
    tenantId,
    customerId: customerId1,
    sellerId,
    totalAmount: 100,
    soldAt: new Date('2025-01-05T10:00:00Z'),
    items: [{ productId, quantity: 1, unitPrice: 100, totalAmount: 100 }],
  });
  await sales.create({
    tenantId,
    customerId: customerId1,
    sellerId,
    totalAmount: 200,
    soldAt: new Date('2025-01-15T10:00:00Z'),
    items: [{ productId, quantity: 2, unitPrice: 100, totalAmount: 200 }],
  });
  await sales.create({
    tenantId,
    customerId: customerId2,
    totalAmount: 150,
    soldAt: new Date('2025-01-20T10:00:00Z'),
    items: [{ productId, quantity: 1, unitPrice: 150, totalAmount: 150 }],
  });
  await sales.create({
    tenantId,
    customerId: customerId3,
    totalAmount: 250,
    soldAt: new Date('2025-01-25T10:00:00Z'),
    items: [{ productId, quantity: 2, unitPrice: 125, totalAmount: 250 }],
  });
  // Cancelled — MUST be excluded from all metrics
  await sales.create({
    tenantId,
    customerId: customerId1,
    totalAmount: 999,
    status: 'cancelled',
    soldAt: new Date('2025-01-10T10:00:00Z'),
    items: [{ productId, quantity: 1, unitPrice: 999, totalAmount: 999 }],
  });

  // -------------------------------------------------------------------------
  // Sales in Dec 2024 (previous period for comparison)
  //   Revenue: 400  |  sales_count: 2
  // -------------------------------------------------------------------------
  await sales.create({
    tenantId,
    customerId: customerId1,
    totalAmount: 200,
    soldAt: new Date('2024-12-10T10:00:00Z'),
    items: [{ productId, quantity: 2, unitPrice: 100, totalAmount: 200 }],
  });
  await sales.create({
    tenantId,
    customerId: customerId2,
    totalAmount: 200,
    soldAt: new Date('2024-12-20T10:00:00Z'),
    items: [{ productId, quantity: 2, unitPrice: 100, totalAmount: 200 }],
  });
});

afterAll(cleanUp);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MetricEngine — revenue', () => {
  it('computes correct revenue for Jan 2025 (excludes cancelled)', async () => {
    const result = await engine.calculate('revenue', { tenantId, period: periodJan });
    expect(result.key).toBe('revenue');
    expect(result.value).toBeCloseTo(700, 2);
  });

  it('returns 0 for an empty period', async () => {
    const empty = { from: new Date('2020-01-01'), to: new Date('2020-02-01') };
    const result = await engine.calculate('revenue', { tenantId, period: empty });
    expect(result.value).toBe(0);
  });
});

describe('MetricEngine — sales_count', () => {
  it('counts only confirmed sales', async () => {
    const result = await engine.calculate('sales_count', { tenantId, period: periodJan });
    expect(result.value).toBe(4);
  });
});

describe('MetricEngine — average_ticket', () => {
  it('computes revenue / sales_count', async () => {
    const result = await engine.calculate('average_ticket', { tenantId, period: periodJan });
    expect(result.value).toBeCloseTo(175, 2); // 700 / 4
  });

  it('returns 0 when no sales in period', async () => {
    const empty = { from: new Date('2020-01-01'), to: new Date('2020-02-01') };
    const result = await engine.calculate('average_ticket', { tenantId, period: empty });
    expect(result.value).toBe(0);
  });
});

describe('MetricEngine — customer_count', () => {
  it('counts distinct customers with confirmed sales', async () => {
    const result = await engine.calculate('customer_count', { tenantId, period: periodJan });
    expect(result.value).toBe(3); // Alice, Bob, Carol
  });
});

describe('MetricEngine — revenue_growth', () => {
  it('computes fractional growth vs previous period', async () => {
    // Jan 700 vs Dec 400 → change = (700-400)/400 = 0.75
    const result = await engine.calculate('revenue_growth', { tenantId, period: periodJan });
    expect(result.value).toBeCloseTo(0.75, 2);
  });
});

describe('MetricEngine — sales_growth', () => {
  it('computes fractional growth in sales count', async () => {
    // Jan 4 vs Dec 2 → change = (4-2)/2 = 1.0
    const result = await engine.calculate('sales_growth', { tenantId, period: periodJan });
    expect(result.value).toBeCloseTo(1.0, 2);
  });
});

describe('MetricEngine — comparison', () => {
  it('includes comparison block with correct previous period values', async () => {
    const result = await engine.calculate('revenue', {
      tenantId,
      period: periodJan,
      withComparison: true,
    });
    expect(result.comparison).toBeDefined();
    expect(result.comparison!.value).toBeCloseTo(400, 2);
    expect(result.comparison!.direction).toBe('up');
    expect(result.comparison!.change).toBeCloseTo(0.75, 2);
  });
});

describe('MetricEngine — breakdown by seller', () => {
  it('returns seller revenue breakdown', async () => {
    const result = await engine.calculate('revenue', {
      tenantId,
      period: periodJan,
      breakdown: { dimension: 'seller' },
    });
    expect(result.breakdown).toBeDefined();
    expect(result.breakdown!.dimension).toBe('seller');
    // Dave (sellerId) got sales of 100+200=300
    const daveItem = result.breakdown!.items.find((i) => i.key === sellerId);
    expect(daveItem).toBeDefined();
    expect(daveItem!.value).toBeCloseTo(300, 2);
  });
});

describe('MetricEngine — breakdown by product', () => {
  it('returns product revenue breakdown', async () => {
    const result = await engine.calculate('revenue', {
      tenantId,
      period: periodJan,
      breakdown: { dimension: 'product' },
    });
    expect(result.breakdown).toBeDefined();
    const widgetItem = result.breakdown!.items.find((i) => i.key === productId);
    expect(widgetItem).toBeDefined();
    expect(widgetItem!.value).toBeCloseTo(700, 2);
  });
});

describe('MetricEngine — calculateAll', () => {
  it('returns all built-in metrics', async () => {
    const results = await engine.calculateAll({ tenantId, period: periodJan });
    expect(results).toHaveLength(METRIC_KEYS.length);
    const keys = results.map((r) => r.key);
    expect(keys).toContain('complaint_count');
    expect(keys).toContain('revenue');
    expect(keys).toContain('sales_count');
    expect(keys).toContain('average_ticket');
    expect(keys).toContain('customer_count');
    expect(keys).toContain('revenue_growth');
    expect(keys).toContain('pending_amount');
  });
});

describe('MetricEngine — tenant isolation', () => {
  it('returns 0 for a different tenant', async () => {
    const other = await tenants.create({ name: 'Other', slug: 'other-metric' });
    const result = await engine.calculate('revenue', { tenantId: other.id, period: periodJan });
    expect(result.value).toBe(0);
    await prisma.tenant.delete({ where: { id: other.id } });
  });
});
