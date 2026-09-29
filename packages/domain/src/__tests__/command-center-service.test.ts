import { describe, expect, it, vi } from 'vitest';
import type { CommandCenterRepository } from '@tactia/database';
import { ErrorCode, type RequestContext } from '@tactia/shared';
import {
  CommandCenterService,
  EvidenceGapService,
  createMeasurementReviewSchema,
} from '../services/command-center-service';

const tenantId = '00000000-0000-4000-8000-000000000001';
const goalId = '00000000-0000-4000-8000-000000000002';
const planId = '00000000-0000-4000-8000-000000000003';
const definitionId = '00000000-0000-4000-8000-000000000004';

function context(role: RequestContext['role'] = 'owner'): RequestContext {
  return { requestId: 'request-1', tenantId, userId: 'user-1', role };
}

function planRow() {
  const now = new Date('2026-09-28T12:00:00Z');
  return {
    id: planId,
    tenantId,
    title: 'Recuperar clientes inativos',
    summary: null,
    scope: {},
    responsibleLabel: 'Equipe comercial',
    status: 'draft',
    version: 1,
    nextReviewAt: null,
    createdAt: now,
    updatedAt: now,
    insightId: null,
    recommendationId: null,
    goalId,
    goal: {
      id: goalId,
      tenantId,
      metricKey: 'revenue',
      scope: 'tenant',
      scopeId: null,
      periodType: 'month',
      periodStart: now,
      target: { toNumber: () => 1000 },
      title: 'Recuperar clientes inativos',
      status: 'active',
      baselineValue: null,
      baselineRef: null,
      ownerUserId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    insight: null,
    recommendation: null,
    steps: [],
    measurementDefinitions: [],
    evidence: [],
    gaps: [],
    reviewDecisions: [],
  };
}

function setup() {
  const repository = {
    findGoal: vi.fn().mockResolvedValue({ id: goalId, tenantId }),
    findInsight: vi.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-000000000005' }),
    findRecommendation: vi.fn().mockResolvedValue(null),
    findRecommendationForPlan: vi.fn().mockResolvedValue(null),
    findPlanByRecommendation: vi.fn().mockResolvedValue(null),
    findDecisionContext: vi.fn().mockResolvedValue(null),
    listDecisionContexts: vi.fn().mockResolvedValue([]),
    createPlan: vi.fn().mockResolvedValue(planRow()),
    updatePlanStatus: vi.fn().mockResolvedValue(planRow()),
    createReview: vi.fn(),
    listGaps: vi.fn().mockResolvedValue({ total: 0, items: [], page: 1, pageSize: 20 }),
    updateGap: vi.fn(),
  } as unknown as CommandCenterRepository;
  return { repository, service: new CommandCenterService(repository) };
}

const validPlan = {
  goalId,
  title: 'Recuperar clientes inativos',
  responsibleLabel: 'Equipe comercial',
  scope: { criterion: '90 dias sem compra' },
  steps: [{ title: 'Preparar contatos' }],
  measurement: {
    metricKey: 'revenue',
    indicator: 'Receita recuperada',
    unit: 'BRL',
    windowFrom: '2026-09-28T00:00:00Z',
    windowTo: '2026-10-28T00:00:00Z',
    sources: [{ type: 'sales' }],
    attribution: 'Variação observada; não implica causalidade.',
  },
};

describe('CommandCenterService', () => {
  it('uses only the authenticated tenant when creating a plan', async () => {
    const { repository, service } = setup();
    await service.createPlan(context(), validPlan);
    expect(repository.findGoal).toHaveBeenCalledWith(tenantId, goalId);
    expect(repository.createPlan).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, goalId, title: validPlan.title }),
    );
  });

  it('does not allow a viewer to prepare a plan', async () => {
    const { repository, service } = setup();
    await expect(service.createPlan(context('viewer'), validPlan)).rejects.toMatchObject({
      code: ErrorCode.AUTHORIZATION_ERROR,
    });
    expect(repository.createPlan).not.toHaveBeenCalled();
  });

  it('rejects an optimistic update when the reviewed version changed', async () => {
    const { repository, service } = setup();
    vi.mocked(repository.updatePlanStatus).mockResolvedValueOnce(null);
    await expect(
      service.updatePlanStatus(context(), planId, { version: 1, status: 'active' }),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });

  it('requires an observed value only for a measured review', () => {
    expect(() =>
      createMeasurementReviewSchema.parse({
        measurementDefinitionId: definitionId,
        status: 'measured',
      }),
    ).toThrow();
    expect(
      createMeasurementReviewSchema.parse({
        measurementDefinitionId: definitionId,
        status: 'not_measurable',
        limitation: 'A fonte de vendas está indisponível.',
      }).observed,
    ).toBeUndefined();
  });

  it('rejects an optional recommendation outside the authenticated tenant', async () => {
    const { repository, service } = setup();
    const recommendationId = '00000000-0000-4000-8000-000000000006';
    await expect(service.createPlan(context(), { ...validPlan, recommendationId }))
      .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    expect(repository.findRecommendation).toHaveBeenCalledWith(tenantId, recommendationId);
    expect(repository.createPlan).not.toHaveBeenCalled();
  });

  it('returns the existing plan when the recommendation was already prepared', async () => {
    const { repository, service } = setup();
    const recommendationId = '00000000-0000-4000-8000-000000000006';
    vi.mocked(repository.findPlanByRecommendation).mockResolvedValueOnce(planRow() as never);
    const result = await service.prepareFromRecommendation(
      context(),
      recommendationId,
      { goalId },
    );
    expect(result.id).toBe(planId);
    expect(repository.createPlan).not.toHaveBeenCalled();
  });

  it('blocks a decision when the plan content version changed', async () => {
    const { repository, service } = setup();
    vi.mocked(repository.findDecisionContext).mockResolvedValueOnce({
      planVersion: 1,
      planStep: { plan: { version: 2 } },
    } as never);
    await expect(
      service.assertDecisionCurrent(context(), '00000000-0000-4000-8000-000000000007'),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });
});

describe('EvidenceGapService', () => {
  it('requires an operator and preserves filters for the repository', async () => {
    const { repository } = setup();
    const service = new EvidenceGapService(repository);
    await expect(service.list(context(), {})).rejects.toMatchObject({
      code: ErrorCode.AUTHENTICATION_ERROR,
    });

    const operator: RequestContext = {
      requestId: 'ops-1',
      tenantId: null,
      userId: null,
      role: null,
      operatorId: 'operator-1',
    };
    await service.list(operator, { tenantId, status: 'new', page: '2' });
    expect(repository.listGaps).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, status: 'new', page: 2, pageSize: 20 }),
    );
  });
});
