import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommandCenterRepository, prisma } from '@tactia/database';
import { CommandCenterService, EvidenceGapService } from '@tactia/domain';
import { ErrorCode, createId, type RequestContext } from '@tactia/shared';

const tenantId = createId();
const otherTenantId = createId();
const goalId = createId();
const repository = new CommandCenterRepository(prisma);
const commandCenter = new CommandCenterService(repository);
const evidenceGaps = new EvidenceGapService(repository);

const owner: RequestContext = {
  requestId: 'command-center-integration',
  tenantId,
  userId: createId(),
  role: 'owner',
};

beforeAll(async () => {
  await prisma.tenant.createMany({ data: [
    { id: tenantId, name: 'Command Center Test', slug: `command-center-${tenantId}` },
    { id: otherTenantId, name: 'Other Tenant', slug: `command-center-${otherTenantId}` },
  ] });
  await prisma.goal.create({ data: {
    id: goalId,
    tenantId,
    metricKey: 'revenue',
    periodType: 'month',
    periodStart: new Date('2026-09-01T00:00:00Z'),
    target: 10000,
    title: 'Recuperar clientes inativos',
    status: 'active',
  } });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await prisma.$disconnect();
});

describe('command center vertical slice', () => {
  let planId = '';
  let definitionId = '';

  it('creates a versioned plan with measurement and no manual reporting step', async () => {
    const plan = await commandCenter.createPlan(owner, {
      goalId,
      title: 'Recuperar clientes inativos',
      summary: 'Preparado a partir das vendas existentes.',
      responsibleLabel: 'Equipe comercial',
      scope: { inactivityDays: 90 },
      steps: [
        { title: 'Preparar contatos', description: 'Lista obtida da fonte de vendas.' },
        { title: 'Acompanhar respostas', description: 'Observação pelo processo comercial existente.' },
      ],
      measurement: {
        metricKey: 'revenue',
        indicator: 'Receita observada da coorte',
        unit: 'BRL',
        windowFrom: '2026-09-01T00:00:00Z',
        windowTo: '2026-10-01T00:00:00Z',
        sources: [{ type: 'sales' }],
        attribution: 'Variação observada; não implica causalidade.',
      },
    });
    planId = plan.id;
    definitionId = plan.measurementDefinitions[0]!.id;
    expect(plan.steps.map((step) => step.title)).toEqual([
      'Preparar contatos',
      'Acompanhar respostas',
    ]);
    expect(plan.measurementDefinitions[0]!.reviews).toEqual([]);
  });

  it('isolates direct plan links by tenant', async () => {
    await expect(commandCenter.getPlan({ ...owner, tenantId: otherTenantId }, planId))
      .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('prevents a stale version from changing the plan twice', async () => {
    const updated = await commandCenter.updatePlanStatus(owner, planId, {
      version: 1,
      status: 'active',
    });
    expect(updated.version).toBe(2);
    await expect(commandCenter.updatePlanStatus(owner, planId, {
      version: 1,
      status: 'closed',
    })).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('deduplicates an operational gap and keeps missing result unknown', async () => {
    const first = await repository.createGap({
      tenantId,
      planId,
      subject: 'Retorno do contato',
      reason: 'A fonte ainda não confirma se houve resposta.',
      impact: 'high',
      dedupeKey: `${planId}:contact-response`,
      nextStep: 'Reconciliar CRM antes de consultar a pessoa responsável.',
    });
    const second = await repository.createGap({
      tenantId,
      planId,
      subject: 'Retorno do contato',
      reason: 'Ainda sem confirmação após reconciliação.',
      impact: 'high',
      dedupeKey: `${planId}:contact-response`,
    });
    expect(second.id).toBe(first.id);
    expect(await prisma.evidenceGap.count({ where: { tenantId, dedupeKey: `${planId}:contact-response` } })).toBe(1);

    const review = await commandCenter.createReview(owner, {
      measurementDefinitionId: definitionId,
      status: 'not_measurable',
      limitation: 'Sem dados de resultado na janela.',
      references: [],
      operationalResults: [],
    });
    expect(review.observed).toBeNull();
    expect(review.status).toBe('not_measurable');

    const operator: RequestContext = {
      requestId: 'ops-command-center',
      tenantId: null,
      userId: null,
      role: null,
      operatorId: createId(),
    };
    const queue = await evidenceGaps.list(operator, { tenantId, status: 'new' });
    expect(queue.total).toBe(1);
    expect(queue.items[0]!.planId).toBe(planId);
  });
});
