import { describe, expect, it, vi } from 'vitest';
import type { CommandCenterEventAggregate, CommandCenterEventRepository } from '@tactia/database';
import { ErrorCode, type RequestContext } from '@tactia/shared';
import {
  COMMAND_CENTER_METRICS_MAX_DAYS,
  CommandCenterMetricsService,
  resolveCommandCenterMetricsWindow,
} from '../services/command-center-metrics-service';

const tenantId = '00000000-0000-4000-8000-000000000011';
const otherTenantId = '00000000-0000-4000-8000-000000000012';

function operator(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'ops-metrics',
    tenantId,
    userId: null,
    role: 'owner',
    operatorId: 'operator-1',
    ...overrides,
  };
}

function emptyAggregate(): CommandCenterEventAggregate {
  return {
    counts: {
      plan_created: 0,
      decision_resolved: 0,
      execution_state_changed: 0,
      clarification_requested: 0,
      clarification_received: 0,
    },
    decisions: { kind: {}, choice: {} },
    executions: { status: {} },
    clarifications: { clear: 0, unclear: 0 },
    daily: [],
  };
}

function setup(aggregate = emptyAggregate()) {
  const events = {
    aggregate: vi.fn().mockResolvedValue(aggregate),
    list: vi.fn().mockResolvedValue({ total: 0, page: 1, pageSize: 20, items: [] }),
  } as unknown as CommandCenterEventRepository;
  return { events, service: new CommandCenterMetricsService(events) };
}

describe('CommandCenterMetricsService', () => {
  it('requires an operator acting on a tenant', async () => {
    const { service } = setup();
    await expect(
      service.summarize({ requestId: 'anon', tenantId, userId: 'user-1', role: 'owner' }),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHENTICATION_ERROR });
    await expect(
      service.summarize({
        requestId: 'ops',
        tenantId: null,
        userId: null,
        role: null,
        operatorId: 'operator-1',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.AUTHORIZATION_ERROR });
  });

  it('rejects an inverted or oversized range', () => {
    expect(() => resolveCommandCenterMetricsWindow({ from: '2026-09-10', to: '2026-09-01' }))
      .toThrow(/início anterior/);
    expect(() => resolveCommandCenterMetricsWindow({ from: '2026-01-01', to: '2026-04-02' }))
      .toThrow(new RegExp(String(COMMAND_CENTER_METRICS_MAX_DAYS)));
    const window = resolveCommandCenterMetricsWindow({ from: '2026-09-01', to: '2026-09-01' });
    expect(window.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-09-02T00:00:00.000Z');
  });

  it('treats an empty event name as no filter', async () => {
    const { events, service } = setup();
    await service.summarize(operator(), { from: '2026-09-01', to: '2026-09-07', name: '' });
    expect(events.list).toHaveBeenCalledWith(expect.objectContaining({ name: undefined }));
  });

  it('queries only the tenant in context and ignores another company in the query string', async () => {
    const { events, service } = setup();
    await service.summarize(operator(), {
      from: '2026-09-01',
      to: '2026-09-07',
      tenantId: otherTenantId,
      page: '2',
      name: 'plan_created',
    });
    expect(events.aggregate).toHaveBeenCalledWith({
      tenantId,
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-09-08T00:00:00.000Z'),
    });
    expect(events.list).toHaveBeenCalledWith(expect.objectContaining({
      tenantId,
      name: 'plan_created',
      page: 2,
      pageSize: 20,
    }));
  });

  it('presents missing events as empty rather than a performance zero', async () => {
    const { service } = setup();
    const result = await service.summarize(operator(), { from: '2026-09-01', to: '2026-09-07' });
    for (const metric of result.metrics) {
      expect(metric.value).toBeNull();
      expect(metric.availability).toBe('empty');
      expect(metric.limitation).toMatch(/não é zero de desempenho|não representa 0%/i);
    }
    const rate = result.metrics.find((metric) => metric.key === 'clarification_response_rate');
    expect(rate?.denominator).toEqual({
      value: 0,
      definition: 'Esclarecimentos solicitados no período.',
    });
    expect(rate?.limitation).toContain('não representa 0%');
    expect(result.unsupported.map((item) => item.key)).toEqual([
      'time_to_first_value',
      'effort_reduction',
      'commercial_outcome',
    ]);
  });

  it('computes rates with an explicit denominator and keeps event payloads free of personal fields', async () => {
    const { events, service } = setup({
      counts: {
        plan_created: 2,
        decision_resolved: 1,
        execution_state_changed: 3,
        clarification_requested: 4,
        clarification_received: 2,
      },
      decisions: { kind: { approval: 1 }, choice: { approved: 1 } },
      executions: { status: { completed: 2, failed: 1 } },
      clarifications: { clear: 1, unclear: 1 },
      daily: [{ day: '2026-09-02', name: 'plan_created' as const, count: 2 }],
    });
    vi.mocked(events.list).mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 20,
      items: [{
        id: 'evt-1',
        name: 'clarification_received',
        entityId: 'clar-1',
        metadata: { gapId: 'gap-1', clear: true },
        occurredAt: new Date('2026-09-02T12:00:00.000Z'),
      }],
    });

    const result = await service.summarize(operator(), { from: '2026-09-01', to: '2026-09-07' });
    expect(result.metrics.find((metric) => metric.key === 'plans_created')).toMatchObject({
      value: 2,
      availability: 'ready',
      unit: 'count',
    });
    expect(result.metrics.find((metric) => metric.key === 'clarification_response_rate')).toMatchObject({
      value: 0.5,
      availability: 'ready',
      denominator: { value: 4, definition: 'Esclarecimentos solicitados no período.' },
    });
    expect(result.metrics.find((metric) => metric.key === 'clarification_clear_rate')).toMatchObject({
      value: 0.5,
      denominator: { value: 2, definition: 'Esclarecimentos recebidos no período.' },
    });
    expect(JSON.stringify(result)).not.toMatch(/telefone|phone|question|answer|@|whatsapp/i);
    expect(result.events.items[0]?.metadata).toEqual({ gapId: 'gap-1', clear: true });
  });
});
