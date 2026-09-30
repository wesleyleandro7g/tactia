import { describe, expect, it, vi } from 'vitest';
import type { CommandCenterRepository } from '@tactia/database';
import { ErrorCode, type RequestContext } from '@tactia/shared';
import {
  CYCLE_REVIEW_MAX_DAYS,
  CommandCenterService,
  resolveCycleReviewWindow,
  serializeCycleReview,
} from '../services/command-center-service';

const tenantId = '00000000-0000-4000-8000-000000000021';
const otherTenantId = '00000000-0000-4000-8000-000000000022';
const planId = '00000000-0000-4000-8000-000000000023';
const goalId = '00000000-0000-4000-8000-000000000024';
const otherPlanId = '00000000-0000-4000-8000-000000000025';

function context(role: RequestContext['role'] = 'owner'): RequestContext {
  return { requestId: 'cycle-review', tenantId, userId: 'user-1', role };
}

function emptyReadings() {
  return {
    plans: [],
    decisions: [],
    approvals: [],
    executions: [],
    gaps: [],
    reviews: [],
  };
}

function plan(overrides: { tenantId?: string; id?: string; status?: string; goalStatus?: string } = {}) {
  const owner = overrides.tenantId ?? tenantId;
  return {
    id: overrides.id ?? planId,
    title: 'Recuperar clientes inativos',
    status: overrides.status ?? 'active',
    version: 1,
    nextReviewAt: null,
    tenantId: owner,
    goal: {
      id: goalId,
      title: 'Receita da coorte',
      status: overrides.goalStatus ?? 'active',
      tenantId: owner,
    },
  };
}

function setup(readings = emptyReadings()) {
  const repository = {
    listCycleReadings: vi.fn().mockResolvedValue(readings),
  } as unknown as CommandCenterRepository;
  return { repository, service: new CommandCenterService(repository) };
}

describe('resolveCycleReviewWindow', () => {
  it('defaults to the last seven UTC days and rejects inverted or oversized ranges', () => {
    const window = resolveCycleReviewWindow({}, new Date('2026-09-29T15:00:00Z'));
    expect(window.from.toISOString()).toBe('2026-09-23T00:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(() => resolveCycleReviewWindow({ from: '2026-09-10', to: '2026-09-01' }))
      .toThrow(/início anterior/);
    expect(() => resolveCycleReviewWindow({ from: '2026-01-01', to: '2026-04-02' }))
      .toThrow(new RegExp(String(CYCLE_REVIEW_MAX_DAYS)));
  });
});

describe('CommandCenterService.getWeeklyCycleReview', () => {
  it('requires a tenant and ignores another company in the query string', async () => {
    const { repository, service } = setup();
    await expect(
      service.getWeeklyCycleReview({ requestId: 'anon', tenantId: null, userId: null, role: null }),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHENTICATION_ERROR });

    await service.getWeeklyCycleReview(context(), {
      from: '2026-09-01',
      to: '2026-09-07',
      tenantId: otherTenantId,
    });
    expect(repository.listCycleReadings).toHaveBeenCalledWith(
      tenantId,
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-09-08T00:00:00.000Z'),
    );
  });

  it('presents an empty window without a commercial zero', async () => {
    const { service } = setup();
    const review = await service.getWeeklyCycleReview(context(), { from: '2026-09-01', to: '2026-09-07' });
    expect(review.inProgress).toEqual([]);
    expect(review.decisions).toEqual([]);
    expect(review.executions).toEqual([]);
    expect(review.gaps).toEqual([]);
    expect(review.observations).toEqual([]);
    expect(review.observations.some((item) => item.observed === 0)).toBe(false);
  });

  it('keeps plan, execution, measurement and goal on independent axes', () => {
    const review = serializeCycleReview(
      tenantId,
      { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-08T00:00:00Z') },
      {
        ...emptyReadings(),
        plans: [plan({ status: 'active', goalStatus: 'active' })],
        executions: [{
          id: 'link-1',
          tenantId,
          createdAt: new Date('2026-09-03T12:00:00Z'),
          planStep: {
            id: 'step-1',
            title: 'Criar tarefa no processo existente',
            tenantId,
            plan: plan({ status: 'active', goalStatus: 'active' }),
          },
          actionExecution: {
            id: 'exec-1',
            status: 'completed',
            tenantId,
            createdAt: new Date('2026-09-03T12:00:00Z'),
            startedAt: new Date('2026-09-03T12:00:00Z'),
            finishedAt: new Date('2026-09-03T12:05:00Z'),
            action: { name: 'Criar tarefa', type: 'create_task' },
          },
        }],
        reviews: [{
          id: 'review-1',
          tenantId,
          status: 'measuring',
          observed: null,
          operationalResults: [],
          references: [],
          limitation: 'Resultado comercial ainda em observação na janela definida.',
          reviewedAt: new Date('2026-09-03T12:06:00Z'),
          createdAt: new Date('2026-09-03T12:06:00Z'),
          measurementDefinition: {
            id: 'def-1',
            tenantId,
            metricKey: 'revenue',
            indicator: 'Receita observada',
            unit: 'BRL',
            baseline: { toNumber: () => 8000 },
            target: { toNumber: () => 10000 },
            windowFrom: new Date('2026-09-01T00:00:00Z'),
            windowTo: new Date('2026-10-01T00:00:00Z'),
            attribution: 'Variação observada; não implica causalidade.',
            sources: [{ type: 'sales' }],
            version: 1,
            plan: plan({ status: 'active', goalStatus: 'active' }),
          },
        }],
      } as never,
    );

    expect(review.executions[0]).toMatchObject({ status: 'completed', planStatus: 'active' });
    expect(review.inProgress[0]).toMatchObject({ status: 'active', goalStatus: 'active' });
    expect(review.observations[0]).toMatchObject({
      observed: null,
      availability: 'empty',
      status: 'measuring',
      goalStatus: 'active',
      planStatus: 'active',
    });
    expect(review.observations[0]?.observed).toBeNull();
  });

  it('drops an optional plan that belongs to another company', () => {
    const review = serializeCycleReview(
      tenantId,
      { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-08T00:00:00Z') },
      {
        ...emptyReadings(),
        gaps: [{
          id: 'gap-1',
          subject: 'Cobertura de contatos',
          reason: 'A fonte ainda não devolveu a lista.',
          impact: 'medium',
          status: 'new',
          planId: otherPlanId,
          tenantId,
          createdAt: new Date('2026-09-03T00:00:00Z'),
          plan: plan({ id: otherPlanId, tenantId: otherTenantId }),
        }],
        reviews: [{
          id: 'review-foreign',
          tenantId,
          status: 'measured',
          observed: { toNumber: () => 9000 },
          operationalResults: [],
          references: [],
          limitation: null,
          reviewedAt: new Date('2026-09-03T00:00:00Z'),
          createdAt: new Date('2026-09-03T00:00:00Z'),
          measurementDefinition: {
            id: 'def-foreign',
            tenantId: otherTenantId,
            metricKey: 'revenue',
            indicator: 'Receita de outra empresa',
            unit: 'BRL',
            baseline: 1,
            target: 2,
            windowFrom: new Date('2026-09-01T00:00:00Z'),
            windowTo: new Date('2026-10-01T00:00:00Z'),
            attribution: 'Não deve aparecer.',
            sources: [],
            version: 1,
            plan: plan({ tenantId: otherTenantId }),
          },
        }],
      } as never,
    );

    expect(review.gaps).toEqual([{
      id: 'gap-1',
      subject: 'Cobertura de contatos',
      reason: 'A fonte ainda não devolveu a lista.',
      impact: 'medium',
      status: 'new',
      planId: null,
      planTitle: null,
    }]);
    expect(review.observations).toEqual([]);
    expect(review.inProgress).toEqual([]);
  });

  it('keeps a true measured zero distinct from missing coverage', () => {
    const review = serializeCycleReview(
      tenantId,
      { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-08T00:00:00Z') },
      {
        ...emptyReadings(),
        reviews: [{
          id: 'review-zero',
          tenantId,
          status: 'measured',
          observed: { toNumber: () => 0 },
          operationalResults: [],
          references: [{ source: 'sales' }],
          limitation: null,
          reviewedAt: new Date('2026-09-04T00:00:00Z'),
          createdAt: new Date('2026-09-04T00:00:00Z'),
          measurementDefinition: {
            id: 'def-zero',
            tenantId,
            metricKey: 'revenue',
            indicator: 'Receita observada',
            unit: 'BRL',
            baseline: { toNumber: () => 100 },
            target: { toNumber: () => 200 },
            windowFrom: new Date('2026-09-01T00:00:00Z'),
            windowTo: new Date('2026-10-01T00:00:00Z'),
            attribution: 'Variação observada; não implica causalidade.',
            sources: [{ type: 'sales' }],
            version: 1,
            plan: plan(),
          },
        }],
      } as never,
    );

    expect(review.observations[0]).toMatchObject({
      observed: 0,
      availability: 'ready',
      status: 'measured',
    });
  });
});
