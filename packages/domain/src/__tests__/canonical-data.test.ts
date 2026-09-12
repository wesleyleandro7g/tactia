import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ActivityRepository,
  AuditLogRepository,
  CustomerRepository,
  LeadRepository,
  MembershipRepository,
  prisma,
  ProductRepository,
  SaleRepository,
  SellerRepository,
  TenantRepository,
  UserRepository,
} from '@tactia/database';
import { AppError, ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { ActivityService } from '../services/activity-service';
import { AuditLogService } from '../services/audit-log-service';
import { CustomerService } from '../services/customer-service';
import { LeadService } from '../services/lead-service';
import { ProductService } from '../services/product-service';
import { SaleService } from '../services/sale-service';
import { SellerService } from '../services/seller-service';
import { TenantService } from '../services/tenant-service';

const tenants = new TenantRepository(prisma);
const users = new UserRepository(prisma);
const memberships = new MembershipRepository(prisma);
const auditLogs = new AuditLogService(new AuditLogRepository(prisma));
const tenantService = new TenantService(tenants, memberships, auditLogs);

const customers = new CustomerRepository(prisma);
const leads = new LeadRepository(prisma);
const products = new ProductRepository(prisma);
const sellers = new SellerRepository(prisma);
const sales = new SaleRepository(prisma);
const activities = new ActivityRepository(prisma);

const customerService = new CustomerService(customers, auditLogs);
const leadService = new LeadService(leads, customers, auditLogs, prisma);
const productService = new ProductService(products, auditLogs);
const sellerService = new SellerService(sellers, auditLogs);
const saleService = new SaleService(sales, customers, products, sellers, auditLogs);
const activityService = new ActivityService(activities, customers, leads, sellers, auditLogs);

async function reset() {
  // Scoped by known slugs to avoid conflicts with other test packages running in parallel
  const testSlugs = ['crud-co', 'tenant-a', 'tenant-b', 'viewer-co'];
  const tenantRows = await prisma.tenant.findMany({ where: { slug: { in: testSlugs } } });
  const ids = tenantRows.map((t) => t.id);

  if (ids.length > 0) {
    await prisma.recommendation.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.insight.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.saleItem.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.sale.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.activity.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.interaction.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.product.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.seller.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.membership.deleteMany({ where: { tenantId: { in: ids } } });
  }
  // Fixture accounts of this file only — deleting every '*.test' account would
  // wipe other test files running against the shared test database.
  const authUsers = await prisma.authUser.findMany({
    where: {
      email: {
        in: ['owner@crud.test', 'a@iso.test', 'b@iso.test', 'owner@viewer.test', 'viewer@viewer.test'],
      },
    },
  });
  const authIds = authUsers.map((a) => a.id);
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

function context(
  partial: Partial<RequestContext> & Pick<RequestContext, 'tenantId' | 'userId' | 'role'>,
): RequestContext {
  return {
    requestId: createId(),
    ip: '127.0.0.1',
    ...partial,
  };
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

describe('canonical data model', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await reset();
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it('supports full CRUD for customers, products, sellers, sales, leads, activities', async () => {
    const { ctx } = await setupTenant('crud-co', 'owner@crud.test');

    const customer = await customerService.create(ctx, {
      name: 'Acme Ltda',
      email: 'contato@acme.test',
    });
    const product = await productService.create(ctx, {
      name: 'Plano Pro',
      sku: 'PRO-1',
      price: 199.9,
      cost: 40,
    });
    const seller = await sellerService.create(ctx, {
      name: 'Ana Vendas',
      email: 'ana@crud.test',
    });
    const lead = await leadService.create(ctx, {
      name: 'Prospect',
      email: 'prospect@crud.test',
      customerId: customer.id,
      status: 'contacted',
    });
    const sale = await saleService.create(ctx, {
      customerId: customer.id,
      sellerId: seller.id,
      soldAt: new Date('2026-08-01T12:00:00.000Z'),
      items: [{ productId: product.id, quantity: 2, unitPrice: 199.9 }],
    });
    const activity = await activityService.create(ctx, {
      type: 'meeting',
      customerId: customer.id,
      sellerId: seller.id,
      leadId: lead.id,
      occurredAt: new Date('2026-08-02T15:00:00.000Z'),
    });

    expect(sale.totalAmount).toBeCloseTo(399.8, 2);
    expect(sale.items).toHaveLength(1);
    expect(product.price).toBe(199.9);

    const listedCustomers = await customerService.list(ctx, { search: 'Acme' });
    expect(listedCustomers.total).toBe(1);

    await customerService.update(ctx, customer.id, { status: 'inactive' });
    await productService.update(ctx, product.id, { price: 249.9 });
    await sellerService.update(ctx, seller.id, { status: 'inactive' });
    await leadService.update(ctx, lead.id, { status: 'qualified' });
    await saleService.update(ctx, sale.id, { status: 'cancelled' });
    await activityService.update(ctx, activity.id, { type: 'call' });

    await customerService.remove(ctx, customer.id);
    await expect(customerService.get(ctx, customer.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });

    const logs = await auditLogs.list({ tenantId: ctx.tenantId!, skip: 0, take: 100 });
    expect(logs.items.some((l) => l.action === 'CUSTOMER_CREATED')).toBe(true);
    expect(logs.items.some((l) => l.action === 'SALE_CREATED')).toBe(true);
    expect(logs.items.some((l) => l.action === 'PRODUCT_UPDATED')).toBe(true);
  });

  it('isolates canonical entities between tenants', async () => {
    const a = await setupTenant('tenant-a', 'a@iso.test');
    const b = await setupTenant('tenant-b', 'b@iso.test');

    const customerA = await customerService.create(a.ctx, { name: 'Cliente A' });
    const productA = await productService.create(a.ctx, { name: 'Produto A', price: 10 });
    const sellerA = await sellerService.create(a.ctx, { name: 'Seller A' });
    const saleA = await saleService.create(a.ctx, {
      customerId: customerA.id,
      sellerId: sellerA.id,
      soldAt: new Date(),
      items: [{ productId: productA.id, quantity: 1, unitPrice: 10 }],
    });
    const leadA = await leadService.create(a.ctx, { name: 'Lead A' });
    const activityA = await activityService.create(a.ctx, {
      type: 'note',
      customerId: customerA.id,
      occurredAt: new Date(),
    });

    await customerService.create(b.ctx, { name: 'Cliente B' });

    await expect(customerService.get(b.ctx, customerA.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    await expect(productService.get(b.ctx, productA.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    await expect(sellerService.get(b.ctx, sellerA.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    await expect(saleService.get(b.ctx, saleA.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    await expect(leadService.get(b.ctx, leadA.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    await expect(activityService.get(b.ctx, activityA.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });

    const listB = await customerService.list(b.ctx, {});
    expect(listB.items.map((c) => c.id)).not.toContain(customerA.id);
    expect(listB.total).toBe(1);

    await expect(
      saleService.create(b.ctx, {
        customerId: customerA.id,
        soldAt: new Date(),
        items: [{ productId: productA.id, quantity: 1, unitPrice: 10 }],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('rejects viewer mutations on business entities', async () => {
    const { tenant, user } = await setupTenant('viewer-co', 'owner@viewer.test');
    const viewerAuth = await prisma.authUser.create({
      data: { id: createId(), name: 'Viewer', email: 'viewer@viewer.test', emailVerified: true },
    });
    const viewer = await users.create({
      externalAuthId: viewerAuth.id,
      name: 'Viewer',
      email: 'viewer@viewer.test',
    });
    await memberships.create({ tenantId: tenant.id, userId: viewer.id, role: 'viewer' });
    const viewerCtx = context({ tenantId: tenant.id, userId: viewer.id, role: 'viewer' });

    await expect(customerService.create(viewerCtx, { name: 'X' })).rejects.toBeInstanceOf(AppError);
    await expect(customerService.create(viewerCtx, { name: 'X' })).rejects.toMatchObject({
      code: ErrorCode.AUTHORIZATION_ERROR,
    });

    // owner can still create; viewer can list
    const ownerCtx = context({ tenantId: tenant.id, userId: user.id, role: 'owner' });
    await customerService.create(ownerCtx, { name: 'Visible' });
    const listed = await customerService.list(viewerCtx, {});
    expect(listed.total).toBe(1);
  });
});
