import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { Tool } from '../types';
import { periodInputSchema, resolvePeriod, type ToolDeps } from './shared';

export function createGetGoalsProgressTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_goals_progress',
    description: 'Progresso das metas: atingido, ritmo necessário, projeção e se está no prazo.',
    inputSchema: z.object({}),
    async execute(ctx) {
      const data = await deps.analytics.getGoalsProgress(ctx);
      return {
        data,
        sources: data.slice(0, 5).map((goal) => ({
          metric: goal.metricKey,
          period: goal.period,
          value: goal.achieved,
          tool: 'get_goals_progress',
          label: `Meta ${goal.metricKey}`,
        })),
      };
    },
  });
}

export function createGetFunnelTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_funnel',
    description: 'Funil de leads: conversão por estágio, tempo médio e leads parados.',
    inputSchema: periodInputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);
      const data = await deps.analytics.getFunnel(ctx, period);
      return {
        data,
        sources: [{ metric: 'funnel', period: data.period, tool: 'get_funnel', label: 'Funil de leads' }],
      };
    },
  });
}

export function createRememberFactTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'remember_fact',
    description:
      'Grava um fato/evento/preferência do negócio informado pelo usuário. Nunca executa ação.',
    inputSchema: z.object({
      kind: z.enum(['fact', 'event', 'preference']).default('fact'),
      text: z.string().min(3).max(4000),
      entityType: z.string().optional(),
      entityId: z.string().uuid().optional(),
    }),
    async execute(ctx, input): Promise<{
      data: { saved: boolean; id?: string; text?: string };
      sources: Array<{ metric: string; tool: string; label: string }>;
    }> {
      if (!deps.facts) return { data: { saved: false }, sources: [] };
      const fact = await deps.facts.create(ctx, { ...input, source: 'chat' });
      return {
        data: { saved: true, id: fact.id, text: fact.text },
        sources: [{ metric: 'business_facts', tool: 'remember_fact', label: fact.text.slice(0, 80) }],
      };
    },
  });
}

export function createListBusinessFactsTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'list_business_facts',
    description: 'Lista fatos/eventos ativos do negócio.',
    inputSchema: z.object({}),
    async execute(ctx): Promise<{
      data: { items: unknown[] };
      sources: Array<{ metric: string; tool: string; label: string }>;
    }> {
      if (!deps.facts) return { data: { items: [] }, sources: [] };
      const data = await deps.facts.listActive(ctx);
      return {
        data,
        sources: [{ metric: 'business_facts', tool: 'list_business_facts', label: `${data.items.length} fatos` }],
      };
    },
  });
}

export function createGetCohortsTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_cohorts',
    description: 'Retenção por coorte mensal de aquisição.',
    inputSchema: z.object({}),
    async execute(ctx) {
      const data = await deps.analytics.getCohorts(ctx);
      return { data, sources: [{ metric: 'cohorts', tool: 'get_cohorts', label: 'Coortes de retenção' }] };
    },
  });
}

export function createGetRfmTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_rfm',
    description: 'Segmentação RFM (campeões, em risco, hibernando).',
    inputSchema: z.object({}),
    async execute(ctx) {
      const data = await deps.analytics.getRfm(ctx);
      return { data, sources: [{ metric: 'rfm', tool: 'get_rfm', label: 'RFM' }] };
    },
  });
}

export function createSimulateTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'simulate',
    description:
      'Simula cenário determinístico: recuperar N clientes em risco, reduzir share de desconto, ritmo para meta.',
    inputSchema: periodInputSchema.extend({
      recoverCustomers: z.number().int().min(0).max(500).optional(),
      discountShare: z.number().min(0).max(1).optional(),
      goalId: z.string().uuid().optional(),
    }),
    async execute(ctx, input) {
      const period = resolvePeriod(input);
      const data = await deps.analytics.simulate(
        ctx,
        {
          recoverCustomers: input.recoverCustomers,
          discountShare: input.discountShare,
          goalId: input.goalId,
        },
        period,
      );
      return {
        data,
        sources: [{ metric: 'simulation', period: { from: period.from.toISOString(), to: period.to.toISOString() }, tool: 'simulate', value: data.effects.total }],
      };
    },
  });
}

export function createGetProfitabilityTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_profitability',
    description: 'Lucro operacional, despesas por categoria e ponto de equilíbrio.',
    inputSchema: periodInputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);
      const data = await deps.analytics.getProfitability(ctx, period);
      return {
        data,
        sources: [{ metric: 'operating_profit', period: data.period, value: data.operatingProfit, tool: 'get_profitability' }],
      };
    },
  });
}

export function createGetCashFlowTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_cash_flow',
    description: 'Caixa: recebido 30d, a vencer 30d, em aberto e vencido.',
    inputSchema: z.object({}),
    async execute(ctx) {
      const data = await deps.analytics.getCashFlow(ctx);
      return {
        data,
        sources: [{ metric: 'receivables_open', value: data.open, tool: 'get_cash_flow', label: 'A receber' }],
      };
    },
  });
}

export function createGetInventoryRiskTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_inventory_risk',
    description: 'Risco de ruptura e estoque parado por produto.',
    inputSchema: z.object({}),
    async execute(ctx) {
      const data = await deps.analytics.getInventoryRisk(ctx);
      return { data, sources: [{ metric: 'stock_cover_days', tool: 'get_inventory_risk', label: 'Estoque' }] };
    },
  });
}

export function createGetAcquisitionTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_acquisition',
    description: 'CAC e leads por origem/campanha.',
    inputSchema: periodInputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);
      const data = await deps.analytics.getAcquisition(ctx, period);
      return {
        data,
        sources: [{ metric: 'cac_by_source', period: data.period, tool: 'get_acquisition', label: 'Aquisição' }],
      };
    },
  });
}
