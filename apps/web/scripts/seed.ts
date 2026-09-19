import { createId } from '@tactia/shared';
import { prisma } from '@tactia/database';
import { DEMO_PLAYBOOK_RECLAMACAO_ATRASO } from '@tactia/domain';
import { auth } from '../src/lib/auth';

const DEMO_EMAIL = 'owner@demo.tactia';
const CUSTOMER_COUNT = 200;
const PRODUCT_COUNT = 50;
const SELLER_COUNT = 10;
const SALE_COUNT = 1000;

function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function ensureIdentity() {
  const existing = await prisma.authUser.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    const user = await prisma.user.findFirst({ where: { externalAuthId: existing.id } });
    const membership = user
      ? await prisma.membership.findFirst({ where: { userId: user.id, role: 'owner' } })
      : null;
    const tenant = membership
      ? await prisma.tenant.findUnique({ where: { id: membership.tenantId } })
      : await prisma.tenant.findUnique({ where: { slug: 'empresa-demo' } });
    if (!user || !tenant) {
      throw new Error('Demo identity incomplete; clear DB and re-seed');
    }
    return { user, tenant };
  }

  const ctx = await auth.$context;
  const authUserId = createId();
  const hash = await ctx.password.hash('password123');
  await prisma.authUser.create({
    data: {
      id: authUserId,
      name: 'Owner Demo',
      email: DEMO_EMAIL,
      emailVerified: true,
    },
  });
  await prisma.authAccount.create({
    data: {
      id: createId(),
      issuer: 'local:credential',
      accountId: authUserId,
      providerId: 'credential',
      userId: authUserId,
      password: hash,
    },
  });

  const user = await prisma.user.create({
    data: {
      id: createId(),
      externalAuthId: authUserId,
      name: 'Owner Demo',
      email: DEMO_EMAIL,
    },
  });

  const tenant = await prisma.tenant.create({
    data: {
      id: createId(),
      name: 'Empresa Demo',
      slug: 'empresa-demo',
    },
  });
  await prisma.membership.create({
    data: {
      id: createId(),
      tenantId: tenant.id,
      userId: user.id,
      role: 'owner',
    },
  });
  await prisma.auditLog.create({
    data: {
      id: createId(),
      tenantId: tenant.id,
      userId: user.id,
      actorType: 'system',
      action: 'TENANT_CREATED',
      entityType: 'tenant',
      entityId: tenant.id,
      metadata: { seed: true },
    },
  });

  return { user, tenant };
}

async function seedBusiness(tenantId: string) {
  const existingCustomers = await prisma.customer.count({ where: { tenantId } });
  if (existingCustomers > 0) {
    console.log('Business seed already applied');
    return;
  }

  const rand = mulberry32(42);
  const categories = ['Software', 'Servicos', 'Hardware', 'Consultoria', 'Suporte'];

  const sellers = await Promise.all(
    Array.from({ length: SELLER_COUNT }, (_, i) =>
      prisma.seller.create({
        data: {
          id: createId(),
          tenantId,
          externalId: `seller-${i + 1}`,
          name: `Vendedor ${i + 1}`,
          email: `vendedor${i + 1}@demo.tactia`,
          status: 'active',
        },
      }),
    ),
  );

  const products = await Promise.all(
    Array.from({ length: PRODUCT_COUNT }, (_, i) => {
      const price = Math.round((50 + rand() * 950) * 100) / 100;
      const cost = Math.round(price * (0.4 + rand() * 0.3) * 100) / 100;
      return prisma.product.create({
        data: {
          id: createId(),
          tenantId,
          externalId: `product-${i + 1}`,
          name: `Produto ${i + 1}`,
          sku: `SKU-${String(i + 1).padStart(3, '0')}`,
          category: categories[i % categories.length],
          supplier: i % 4 === 0 ? 'Fornecedor Alfa' : 'Fornecedor Beta',
          cost,
          price,
          status: 'active',
        },
      });
    }),
  );

  const customers = await Promise.all(
    Array.from({ length: CUSTOMER_COUNT }, (_, i) =>
      prisma.customer.create({
        data: {
          id: createId(),
          tenantId,
          externalId: `customer-${i + 1}`,
          name: `Cliente ${i + 1}`,
          email: `cliente${i + 1}@demo.tactia`,
          phone: `119${String(10000000 + i).slice(0, 8)}`,
          document: String(10000000000 + i),
          status: rand() > 0.1 ? 'active' : 'inactive',
          segment: i % 5 === 0 ? 'enterprise' : i % 2 === 0 ? 'smb' : 'startup',
          city: i % 3 === 0 ? 'São Paulo' : i % 3 === 1 ? 'Curitiba' : 'Belo Horizonte',
          state: i % 3 === 0 ? 'SP' : i % 3 === 1 ? 'PR' : 'MG',
          acquisitionSource: i % 2 === 0 ? 'website' : 'referral',
        },
      }),
    ),
  );

  // ~30 leads, some inactive (>7 days without activity) for Etapa 5
  const leads = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      prisma.lead.create({
        data: {
          id: createId(),
          tenantId,
          externalId: `lead-${i + 1}`,
          customerId: i < 10 ? customers[i]!.id : null,
          sellerId: sellers[i % sellers.length]!.id,
          name: `Lead ${i + 1}`,
          email: `lead${i + 1}@demo.tactia`,
          source: i % 2 === 0 ? 'website' : 'referral',
          status: (['new', 'contacted', 'qualified', 'proposal'] as const)[i % 4],
          score: Math.floor(rand() * 100),
        },
      }),
    ),
  );

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i]!;
    // First 10 leads have recent activity; rest are stale (>7 days)
    const occurredAt = i < 10 ? daysAgo(Math.floor(rand() * 5)) : daysAgo(10 + Math.floor(rand() * 40));
    await prisma.activity.create({
      data: {
        id: createId(),
        tenantId,
        type: 'call',
        leadId: lead.id,
        sellerId: sellers[i % sellers.length]!.id,
        occurredAt,
        metadata: { seed: true },
      },
    });
  }

  // Sales over last ~180 days with intentional revenue drop in the last ~21 days
  for (let i = 0; i < SALE_COUNT; i++) {
    const dayOffset = Math.floor(rand() * 180);
    const soldAt = daysAgo(dayOffset);
    const inDropWindow = dayOffset <= 21;
    const customer = customers[Math.floor(rand() * customers.length)]!;
    const seller = sellers[Math.floor(rand() * sellers.length)]!;
    const itemCount = 1 + Math.floor(rand() * 3);
    const items = [];
    let totalAmount = 0;

    for (let j = 0; j < itemCount; j++) {
      const product = products[Math.floor(rand() * products.length)]!;
      const quantity = 1 + Math.floor(rand() * 4);
      const unitPrice = Number(product.price ?? 100);
      // During drop window: fewer/cheaper effective line totals (~40% of baseline)
      const factor = inDropWindow ? 0.35 + rand() * 0.15 : 0.9 + rand() * 0.3;
      const lineTotal = Math.round(quantity * unitPrice * factor * 100) / 100;
      totalAmount += lineTotal;
      items.push({
        id: createId(),
        tenantId,
        productId: product.id,
        quantity,
        unitPrice,
        discountAmount: 0,
        totalAmount: lineTotal,
      });
    }

    // Extra skip probability in drop window to reduce volume further
    if (inDropWindow && rand() < 0.45) {
      continue;
    }

    const statusRoll = rand();
    const status = statusRoll > 0.95 ? 'cancelled' : statusRoll > 0.92 ? 'refunded' : 'confirmed';

    await prisma.sale.create({
      data: {
        id: createId(),
        tenantId,
        externalId: `sale-${i + 1}`,
        customerId: customer.id,
        sellerId: seller.id,
        totalAmount: Math.round(totalAmount * 100) / 100,
        discountAmount: 0,
        currency: 'BRL',
        status,
        soldAt,
        paymentMethod: i % 3 === 0 ? 'boleto' : i % 3 === 1 ? 'pix' : 'card',
        channel: i % 2 === 0 ? 'inside_sales' : 'partner',
        region: i % 3 === 0 ? 'sudeste' : i % 3 === 1 ? 'sul' : 'nordeste',
        metadata: { seed: true, dropWindow: inDropWindow },
        items: { create: items },
      },
    });
  }

  const saleCount = await prisma.sale.count({ where: { tenantId } });
  console.log(
    `Business seed: ${CUSTOMER_COUNT} customers, ${PRODUCT_COUNT} products, ${SELLER_COUNT} sellers, ${saleCount} sales, ${leads.length} leads`,
  );
}

async function seedInteractions(tenantId: string, customerIds: string[]) {
  const existing = await prisma.interaction.count({ where: { tenantId } });
  if (existing > 0) {
    console.log(`Interactions seed: ${existing} already present, skipping`);
    return;
  }

  const samples = [
    {
      channel: 'whatsapp' as const,
      intent: 'complaint' as const,
      topics: ['atraso'],
      body: 'Meu pedido atrasou de novo. Péssimo atendimento, quero cancelar.',
      daysAgo: 3,
    },
    {
      channel: 'email' as const,
      intent: 'complaint' as const,
      topics: ['qualidade'],
      body: 'O produto chegou quebrado e ninguém responde o chamado.',
      daysAgo: 8,
    },
    {
      channel: 'whatsapp' as const,
      intent: 'praise' as const,
      topics: ['atendimento'],
      body: 'Excelente, obrigado pelo suporte rápido. Parabéns à equipe.',
      daysAgo: 5,
    },
    {
      channel: 'note' as const,
      intent: 'question' as const,
      topics: ['boleto'],
      body: 'Quando vence o boleto da fatura deste mês?',
      daysAgo: 2,
    },
  ];

  for (const [index, sample] of samples.entries()) {
    await prisma.interaction.create({
      data: {
        id: createId(),
        tenantId,
        customerId: customerIds[index % customerIds.length] ?? null,
        channel: sample.channel,
        direction: 'inbound',
        body: sample.body,
        occurredAt: daysAgo(sample.daysAgo),
        intent: sample.intent,
        topics: sample.topics,
        metadata: { seed: true },
      },
    });
  }
  console.log(`Interactions seed: ${samples.length} messages`);
}

function brCalendarParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * Fills the current calendar month (America/Sao_Paulo) when the DB was seeded
 * before month rollover. Idempotent: skips if any sale already exists in-month.
 */
async function seedCurrentMonthSales(tenantId: string) {
  const { year, month, day: todayDay } = brCalendarParts();
  // soldAt noon UTC on each calendar day (matches historical seed pattern)
  const monthStart = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0, 0));
  const monthEndExclusive = new Date(Date.UTC(year, month, 1, 12, 0, 0, 0));
  const throughDay = new Date(Date.UTC(year, month - 1, todayDay + 1, 12, 0, 0, 0));
  const rangeEnd = throughDay < monthEndExclusive ? throughDay : monthEndExclusive;

  const existing = await prisma.sale.count({
    where: {
      tenantId,
      soldAt: { gte: monthStart, lt: rangeEnd },
    },
  });
  if (existing > 0) {
    console.log(`Current-month sales seed: ${existing} already present, skipping`);
    return;
  }

  const [customers, products, sellers] = await Promise.all([
    prisma.customer.findMany({
      where: { tenantId, status: 'active', deletedAt: null },
      select: { id: true },
    }),
    prisma.product.findMany({
      where: { tenantId, status: 'active' },
      select: { id: true, price: true },
    }),
    prisma.seller.findMany({
      where: { tenantId, status: 'active' },
      select: { id: true },
    }),
  ]);

  if (customers.length === 0 || products.length === 0 || sellers.length === 0) {
    console.log('Current-month sales seed: missing customers/products/sellers, skipping');
    return;
  }

  const rand = mulberry32(year * 100 + month);
  const dayCount = todayDay;
  // ~5–8 sales/day → healthy "este mês" demo (August pace without drop window)
  const targetSales = dayCount * (5 + Math.floor(rand() * 4));
  const existingSaleCount = await prisma.sale.count({ where: { tenantId } });
  const monthTag = `${year}${String(month).padStart(2, '0')}`;

  let created = 0;
  for (let i = 0; i < targetSales; i++) {
    const dayOfMonth = 1 + Math.floor(rand() * dayCount);
    const soldAt = new Date(Date.UTC(year, month - 1, dayOfMonth, 12, 0, 0, 0));

    const customer = customers[Math.floor(rand() * customers.length)]!;
    const seller = sellers[Math.floor(rand() * sellers.length)]!;
    const itemCount = 1 + Math.floor(rand() * 3);
    const items = [];
    let totalAmount = 0;

    for (let j = 0; j < itemCount; j++) {
      const product = products[Math.floor(rand() * products.length)]!;
      const quantity = 1 + Math.floor(rand() * 4);
      const unitPrice = Number(product.price ?? 100);
      const factor = 0.9 + rand() * 0.3;
      const lineTotal = Math.round(quantity * unitPrice * factor * 100) / 100;
      totalAmount += lineTotal;
      items.push({
        id: createId(),
        tenantId,
        productId: product.id,
        quantity,
        unitPrice,
        discountAmount: 0,
        totalAmount: lineTotal,
      });
    }

    const statusRoll = rand();
    const status = statusRoll > 0.95 ? 'cancelled' : statusRoll > 0.92 ? 'refunded' : 'confirmed';

    await prisma.sale.create({
      data: {
        id: createId(),
        tenantId,
        externalId: `sale-${monthTag}-${existingSaleCount + created + 1}`,
        customerId: customer.id,
        sellerId: seller.id,
        totalAmount: Math.round(totalAmount * 100) / 100,
        discountAmount: 0,
        currency: 'BRL',
        status,
        soldAt,
        metadata: { seed: true, currentMonthTopUp: true },
        items: { create: items },
      },
    });
    created += 1;
  }

  console.log(`Current-month sales seed: ${created} sales across ${dayCount} day(s) of ${monthTag}`);
}

async function seedActions(tenantId: string) {
  // Built-in action definitions (Etapa 7). Idempotent: skips existing types.
  const defaults = [
    {
      type: 'create_task' as const,
      name: 'Criar tarefa',
      description:
        'Cria uma tarefa (Activity do tipo task) para acompanhamento de um cliente, lead ou vendedor.',
    },
    {
      type: 'send_email' as const,
      name: 'Enviar e-mail',
      description: 'Envia um e-mail para um contato (cliente, lead ou vendedor).',
    },
  ];

  let created = 0;
  for (const definition of defaults) {
    const existing = await prisma.action.findFirst({
      where: { tenantId, type: definition.type },
    });
    if (existing) continue;
    await prisma.action.create({
      data: {
        id: createId(),
        tenantId,
        type: definition.type,
        name: definition.name,
        description: definition.description,
        configuration: {},
        requiresApproval: true,
      },
    });
    created += 1;
  }
  console.log(`Actions seed: ${created} new definition(s), ${defaults.length} total`);
}

async function seedExtendedEntities(tenantId: string) {
  const existingExpenses = await prisma.expense.count({ where: { tenantId } });
  if (existingExpenses > 0) {
    console.log('Extended seed already applied');
    return;
  }

  const categories = ['folha', 'aluguel', 'marketing', 'software', 'logistica'];
  for (let i = 0; i < 24; i++) {
    await prisma.expense.create({
      data: {
        id: createId(),
        tenantId,
        externalId: `expense-${i + 1}`,
        category: categories[i % categories.length]!,
        description: `Despesa ${categories[i % categories.length]} ${i + 1}`,
        amount: 8000 + (i % 5) * 1500,
        occurredAt: daysAgo(10 + i * 7),
        recurring: i % 4 === 0,
        supplier: i % 2 === 0 ? 'Fornecedor Alfa' : 'Fornecedor Beta',
      },
    });
  }

  const sales = await prisma.sale.findMany({
    where: { tenantId, status: 'confirmed' },
    select: { id: true, totalAmount: true, soldAt: true },
    take: 80,
    orderBy: { soldAt: 'desc' },
  });
  for (let i = 0; i < sales.length; i++) {
    const sale = sales[i]!;
    const paid = i % 5 !== 0;
    const overdue = i % 7 === 0;
    await prisma.payment.create({
      data: {
        id: createId(),
        tenantId,
        externalId: `payment-${i + 1}`,
        saleId: sale.id,
        amount: sale.totalAmount,
        method: i % 2 === 0 ? 'boleto' : 'pix',
        dueAt: new Date(sale.soldAt.getTime() + 14 * 24 * 60 * 60 * 1000),
        paidAt: paid ? new Date(sale.soldAt.getTime() + 10 * 24 * 60 * 60 * 1000) : null,
        status: paid ? 'paid' : overdue ? 'overdue' : 'pending',
      },
    });
  }

  const products = await prisma.product.findMany({
    where: { tenantId },
    select: { id: true },
    take: 20,
  });
  for (let i = 0; i < products.length; i++) {
    await prisma.inventoryLevel.create({
      data: {
        id: createId(),
        tenantId,
        externalId: `stock-${i + 1}`,
        productId: products[i]!.id,
        quantity: i < 4 ? 2 : i > 15 ? 180 : 40,
        minQuantity: 10,
        recordedAt: daysAgo(1),
      },
    });
  }

  const campaignSources = ['website', 'ads', 'referral'];
  for (let i = 0; i < 3; i++) {
    await prisma.campaign.create({
      data: {
        id: createId(),
        tenantId,
        externalId: `campaign-${i + 1}`,
        name: `Campanha ${campaignSources[i]}`,
        source: campaignSources[i]!,
        spend: 4000 + i * 2500,
        startsAt: daysAgo(40),
        endsAt: daysAgo(5),
      },
    });
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  await prisma.goal.create({
    data: {
      id: createId(),
      tenantId,
      scope: 'tenant',
      metricKey: 'revenue',
      periodType: 'month',
      periodStart: monthStart,
      target: 180000,
    },
  });

  await prisma.businessFact.create({
    data: {
      id: createId(),
      tenantId,
      kind: 'event',
      text: 'A vendedora Ana ficou de licença nas duas últimas semanas de agosto.',
      source: 'user',
    },
  });

  const leads = await prisma.lead.findMany({ where: { tenantId }, select: { id: true, status: true, sellerId: true } });
  for (const lead of leads) {
    if (lead.status === 'new') continue;
    await prisma.leadStageTransition.create({
      data: {
        id: createId(),
        tenantId,
        leadId: lead.id,
        fromStatus: 'new',
        toStatus: lead.status,
        occurredAt: daysAgo(20),
        sellerId: lead.sellerId,
      },
    });
  }

  console.log(
    `Extended seed: ${await prisma.expense.count({ where: { tenantId } })} expenses, ${await prisma.payment.count({ where: { tenantId } })} payments, ${await prisma.inventoryLevel.count({ where: { tenantId } })} inventory rows, ${await prisma.campaign.count({ where: { tenantId } })} campaigns`,
  );
}

async function seedPlaybooks(tenantId: string) {
  const existing = await prisma.playbook.findUnique({
    where: { tenantId_slug: { tenantId, slug: DEMO_PLAYBOOK_RECLAMACAO_ATRASO.slug } },
  });
  if (existing) return;
  await prisma.playbook.create({
    data: {
      id: createId(),
      tenantId,
      slug: DEMO_PLAYBOOK_RECLAMACAO_ATRASO.slug,
      title: DEMO_PLAYBOOK_RECLAMACAO_ATRASO.title,
      trigger: DEMO_PLAYBOOK_RECLAMACAO_ATRASO.trigger,
      steps: DEMO_PLAYBOOK_RECLAMACAO_ATRASO.steps,
      enabled: true,
    },
  });
}

async function main() {
  const { tenant } = await ensureIdentity();
  console.log(`Identity ready: ${DEMO_EMAIL} / password123 (${tenant.name})`);
  await seedBusiness(tenant.id);
  await seedCurrentMonthSales(tenant.id);
  await seedActions(tenant.id);
  await seedExtendedEntities(tenant.id);
  await seedPlaybooks(tenant.id);
  const customerRows = await prisma.customer.findMany({
    where: { tenantId: tenant.id },
    select: { id: true },
    take: 8,
  });
  await seedInteractions(
    tenant.id,
    customerRows.map((row) => row.id),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
