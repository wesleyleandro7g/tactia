import { createId } from '@tactia/shared';
import { prisma } from '@tactia/database';
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
      issuer: process.env.NODE_ENV === 'production' ? 'credential' : 'local:credential',
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

async function main() {
  const { tenant } = await ensureIdentity();
  console.log(`Identity ready: ${DEMO_EMAIL} / password123 (${tenant.name})`);
  await seedBusiness(tenant.id);
  await seedActions(tenant.id);
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
