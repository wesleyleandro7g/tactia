import type { MetricResult } from '@tactia/intelligence';
import { createId, type RequestContext } from '@tactia/shared';
import { MockLLMAdapter } from '../adapters/mock-llm-adapter';
import type { AiContext } from '../context-builder';
import { Orchestrator, type ContextSource } from '../orchestrator';
import { ToolRegistry } from '../tool-registry';
import { createDefaultTools, type ActionProposalPort, type ToolDeps } from '../tools/index';
import type { ChatAnswer, ToolContext } from '../types';
import type { EvalCase } from './types';

const PERIOD = { from: '2025-01-01T00:00:00.000Z', to: '2025-02-01T00:00:00.000Z' };

const revenueMetric: MetricResult = {
  key: 'revenue',
  value: 1500,
  period: PERIOD,
  comparison: {
    value: 2000,
    period: PERIOD,
    change: -0.25,
    direction: 'down',
  },
  breakdown: {
    dimension: 'product',
    items: [{ key: 'prod-1', label: 'Plano Pro', value: 1500 }],
  },
};

function evalDeps(): ToolDeps {
  return {
    metrics: {
      calculate: async () => revenueMetric,
    },
    analytics: {
      explainChange: async () => ({
        metric: 'revenue',
        period: PERIOD,
        comparisonPeriod: PERIOD,
        current: 1500,
        previous: 2000,
        delta: -500,
        change: -0.25,
        byDimension: [],
        summary: 'Queda de receita no período.',
      }),
      comparePeriods: async () => ({ evidence: [revenueMetric] }),
      getCustomerSegments: async () => ({ totals: { churnRisk: 1, activeInPeriod: 4 } }),
      getRfm: async () => ({ groups: [] }),
      getSalesHealth: async () => ({ metrics: { revenue: revenueMetric } }),
      getSellerPerformance: async () => ({ ranking: [] }),
    },
    products: { list: async () => ({ items: [], total: 1, page: 1, pageSize: 1 }) },
    sellers: { list: async () => ({ items: [], total: 1, page: 1, pageSize: 1 }) },
    customers: { list: async () => ({ items: [], total: 1, page: 1, pageSize: 1 }) },
    insights: {
      list: async () => ({
        items: [],
        total: 1,
        page: 1,
        pageSize: 10,
      }),
    },
    recommendations: { list: async () => ({ items: [], total: 0, page: 1, pageSize: 10 }) },
    sales: {},
    interactions: { list: async () => ({ items: [], total: 0 }), searchSemantic: async () => [] },
    briefings: { latest: async () => null },
    facts: { create: async () => ({ id: 'fact-1', text: 'ok' }), listActive: async () => ({ items: [] }) },
  } as unknown as ToolDeps;
}

function actionProposer(): ActionProposalPort {
  return {
    async propose(_ctx, input) {
      return {
        id: 'execution-1',
        actionType: input.actionType,
        status: 'awaiting_approval',
        requiresApproval: true,
        approvalId: 'approval-1',
      };
    },
  };
}

function toolContext(role: ToolContext['role']): ToolContext {
  const base: RequestContext = {
    requestId: createId(),
    tenantId: 'tenant-1',
    userId: 'user-1',
    role,
    ip: '127.0.0.1',
  };
  return base as ToolContext;
}

function contextSource(overrides: Partial<AiContext> = {}): ContextSource {
  return {
    async build(): Promise<AiContext> {
      return {
        company: {
          id: 'tenant-1',
          name: 'Demo Ltda',
          currency: 'BRL',
          timezone: 'America/Sao_Paulo',
          today: '2025-01-31',
          weekday: 'sexta-feira',
          daysLeftInMonth: 1,
          daysElapsedInMonth: 31,
        },
        period: PERIOD,
        trailing30: [],
        trailingPeriod: PERIOD,
        goals: [],
        facts: [],
        briefing: null,
        metrics: [{ key: 'revenue', value: 1500, change: -0.25, direction: 'down' }],
        insights: [],
        sources: [{ metric: 'revenue', period: PERIOD, value: 1500, tool: 'context' }],
        ...overrides,
      };
    },
  };
}

export async function runEvalCase(evalCase: EvalCase): Promise<ChatAnswer> {
  const llm = new MockLLMAdapter({ script: evalCase.script });
  const orchestrator = new Orchestrator({
    llm,
    tools: new ToolRegistry(createDefaultTools(evalDeps(), { actionProposer: actionProposer() })),
    contextBuilder: contextSource(evalCase.context),
  });

  return orchestrator.run({
    ctx: toolContext(evalCase.role ?? 'member'),
    question: evalCase.question,
  });
}
