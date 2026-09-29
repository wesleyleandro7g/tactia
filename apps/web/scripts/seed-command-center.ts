import { CommandCenterRepository, prisma } from '@tactia/database';
import { CommandCenterService } from '@tactia/domain';
import { createId, type RequestContext } from '@tactia/shared';
import { refreshPlanMeasurements } from '../src/lib/services';

const SOURCE_NAME = 'Vendas sintéticas (seed)';
const GOAL_TITLE = 'Acompanhar receita mensal';
const PLAN_TITLE = 'Reativar relacionamento comercial';
const INSIGHT_RULE = 'demo_inactive_customers';

function monthWindow(now: Date) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const previousFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { from, to, previousFrom };
}

export async function seedCommandCenter(tenantId: string, userId: string, now = new Date()) {
  const repository = new CommandCenterRepository(prisma);
  const service = new CommandCenterService(repository);
  const ctx: RequestContext = { requestId: 'demo-command-center-seed', tenantId, userId, role: 'owner' };
  const { from, to, previousFrom } = monthWindow(now);

  await prisma.tenant.updateMany({
    where: { id: tenantId, commandCenterEnabled: null },
    data: { commandCenterEnabled: true },
  });

  let source = await prisma.dataSource.findFirst({ where: { tenantId, name: SOURCE_NAME } });
  if (!source) {
    source = await prisma.dataSource.create({
      data: {
        id: createId(), tenantId, type: 'demo', name: SOURCE_NAME,
        status: 'active', configuration: { seed: true, synthetic: true }, lastSyncAt: now,
      },
    });
  }

  const previousSales = await prisma.sale.aggregate({
    where: { tenantId, status: 'confirmed', soldAt: { gte: previousFrom, lt: from } },
    _sum: { totalAmount: true },
    _count: { id: true },
  });
  const baseline = previousSales._count.id > 0 ? Number(previousSales._sum.totalAmount ?? 0) : null;
  let goal = await prisma.goal.findFirst({ where: { tenantId, title: GOAL_TITLE, periodStart: from } });
  if (!goal) {
    goal = await prisma.goal.create({
      data: {
        id: createId(), tenantId, title: GOAL_TITLE, scope: 'tenant', metricKey: 'revenue',
        periodType: 'month', periodStart: from, status: 'active',
        target: Math.round(Math.max((baseline ?? 100000) * 1.1, 100000)),
        baselineValue: baseline,
        baselineRef: { source: SOURCE_NAME, periodFrom: previousFrom.toISOString(), periodTo: from.toISOString(), synthetic: true },
      },
    });
  }

  let plan = await prisma.plan.findFirst({ where: { tenantId, goalId: goal.id, title: PLAN_TITLE } });
  if (!plan) {
    const created = await service.createPlan(ctx, {
      goalId: goal.id,
      title: PLAN_TITLE,
      summary: 'Plano demonstrativo para revisar contatos da carteira; a receita total é acompanhada nas vendas sintéticas.',
      responsibleLabel: 'Equipe comercial',
      scope: {
        origin: 'seed', cohort: 'Clientes sem compra recente',
        suggestedAction: {
          actionType: 'create_task',
          input: { title: 'Revisar clientes sem compra recente', description: 'Priorizar contatos no processo comercial existente.' },
          reason: 'Retomar relacionamento com clientes inativos.',
        },
      },
      steps: [
        { title: 'Revisar clientes sem compra recente', description: 'Decisão e execução pelo fluxo de ações existente.' },
        { title: 'Acompanhar execução e receita', description: 'A Tactia observa as fontes; nenhum check-in manual é necessário.' },
      ],
      measurement: {
        metricKey: 'revenue', indicator: 'Receita total observada', unit: 'BRL',
        cohort: { description: 'Receita total da empresa; não isolada à carteira contatada' },
        windowFrom: from, windowTo: to, baseline, target: Number(goal.target),
        sources: [{ dataSourceId: source.id, label: source.name, type: source.type, role: 'intended' }],
        attribution: 'Dados sintéticos de demonstração. A métrica cobre as vendas confirmadas da empresa, não apenas a carteira contatada; não demonstra causalidade da Tactia.',
      },
    }, { publish: true });
    plan = await prisma.plan.findUniqueOrThrow({ where: { id: created.id } });
  }

  const gapKey = `demo:crm-coverage:${plan.id}`;
  if (!(await prisma.evidenceGap.findUnique({ where: { tenantId_dedupeKey: { tenantId, dedupeKey: gapKey } } }))) {
    await repository.createGap({
      tenantId, planId: plan.id, dedupeKey: gapKey, impact: 'medium',
      subject: 'Cobertura de contatos da carteira',
      reason: 'A fonte sintética de vendas não comprova quais contatos comerciais ocorreram.',
      sourcesAttempted: [{ dataSourceId: source.id, status: 'insufficient_for_contact_tracking' }],
      nextStep: 'Conectar uma fonte de CRM antes de afirmar que o contato foi realizado.',
    });
  }

  const cutoff = new Date(now.getTime() - 90 * 86400000);
  const [customers, recentSales] = await Promise.all([
    prisma.customer.findMany({ where: { tenantId, status: 'active', deletedAt: null }, select: { id: true } }),
    prisma.sale.findMany({ where: { tenantId, status: 'confirmed', soldAt: { gte: cutoff, lte: now } }, select: { customerId: true }, distinct: ['customerId'] }),
  ]);
  const buyers = new Set(recentSales.map((sale) => sale.customerId));
  const inactiveCount = customers.filter((customer) => !buyers.has(customer.id)).length;
  const fingerprint = `${INSIGHT_RULE}:${tenantId}:${from.toISOString()}`;
  let insight = await prisma.insight.findFirst({ where: { tenantId, fingerprint } });
  if (!insight) {
    insight = await prisma.insight.create({
      data: {
        id: createId(), tenantId, type: 'opportunity', severity: 'medium', status: 'open',
        title: 'Clientes sem compra recente na base sintética',
        description: 'Há clientes ativos sem venda confirmada nos últimos 90 dias; confirme a cobertura de CRM antes de atribuir o resultado aos contatos.',
        ruleKey: INSIGHT_RULE, evidence: [{ key: 'inactive_customers_count', value: inactiveCount }],
        periodFrom: cutoff, periodTo: now, score: 55, fingerprint,
      },
    });
  }
  if (!(await prisma.recommendation.findFirst({ where: { tenantId, insightId: insight.id } }))) {
    await prisma.recommendation.create({
      data: {
        id: createId(), tenantId, insightId: insight.id, priority: 'medium', status: 'pending',
        title: 'Revisar clientes sem compra recente',
        description: 'Preparar uma tarefa de revisão da carteira sem exigir atualização manual do cliente.',
        actionType: 'create_task',
        metadata: {
          seed: true,
          suggestedAction: {
            actionType: 'create_task',
            input: { title: 'Revisar carteira inativa', description: 'Validar clientes sem compra recente no CRM.' },
            reason: 'Identificar oportunidades de retomada sem presumir conversão.',
          },
        },
      },
    });
  }

  const measurement = await refreshPlanMeasurements(tenantId, now);
  console.log(`Command center seed: tenant=${tenantId}, goal=${goal.id}, plan=${plan.id}, inactiveCustomers=${inactiveCount}, measured=${measurement.measured}, unavailable=${measurement.unavailable}`);
  return { goalId: goal.id, planId: plan.id, sourceId: source.id, inactiveCount };
}
