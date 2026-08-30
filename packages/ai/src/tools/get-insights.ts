import { z } from 'zod';
import type { MetricResult } from '@tactia/intelligence';
import { defineTool } from '../tool-registry';
import type { MessageSource, Tool } from '../types';
import { sourceFromMetric, type ToolDeps } from './shared';

const inputSchema = z.object({
  status: z
    .enum(['open', 'acknowledged', 'resolved', 'dismissed'])
    .describe('Filtra por status do insight. Padrão: open.')
    .optional()
    .default('open'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .describe('Quantidade de insights a retornar.')
    .optional()
    .default(10),
  includePendingRecommendations: z
    .boolean()
    .describe('Inclui as recomendações pendentes do tenant.')
    .optional()
    .default(true),
});

function isMetricResult(value: unknown): value is MetricResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as MetricResult).key === 'string' &&
    typeof (value as MetricResult).value === 'number'
  );
}

/**
 * get_insights — insights determinísticos já detectados pelo RuleEngine (Etapa 5).
 * A evidência de cada insight (MetricResults) vira fonte citável na resposta.
 */
export function createGetInsightsTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_insights',
    description:
      'Retorna os insights detectados pelas regras determinísticas (quedas de receita, ' +
      'produtos em declínio, clientes/leads inativos, desvio de vendedores) com severidade, ' +
      'evidência e recomendações pendentes. Use para "por que as vendas caíram?" ou ' +
      '"o que devo priorizar hoje?".',
    inputSchema,
    async execute(ctx, input) {
      const insightPage = await deps.insights.list(ctx, {
        status: input.status,
        page: '1',
        pageSize: String(input.limit),
      });

      const sources: MessageSource[] = [];
      const insights = insightPage.items.map((insight) => {
        const evidence = Array.isArray(insight.evidence) ? insight.evidence : [];
        for (const item of evidence) {
          if (isMetricResult(item)) sources.push(sourceFromMetric(item, 'get_insights'));
        }
        return {
          id: insight.id,
          ruleKey: insight.ruleKey,
          type: insight.type,
          severity: insight.severity,
          status: insight.status,
          title: insight.title,
          description: insight.description,
          period: {
            from: insight.periodFrom.toISOString(),
            to: insight.periodTo.toISOString(),
          },
          evidence: evidence.filter(isMetricResult).map((metric) => ({
            metric: metric.key,
            value: metric.value,
            period: metric.period,
            comparison: metric.comparison,
          })),
          recommendations: insight.recommendations.map((recommendation) => ({
            id: recommendation.id,
            title: recommendation.title,
            description: recommendation.description,
            priority: recommendation.priority,
            status: recommendation.status,
            actionType: recommendation.actionType,
          })),
        };
      });

      const pendingRecommendations = input.includePendingRecommendations
        ? await deps.recommendations.list(ctx, { status: 'pending', page: '1', pageSize: '10' })
        : null;

      sources.push({
        metric: 'insights',
        tool: 'get_insights',
        value: insightPage.total,
        label: `${insightPage.total} insight(s) com status ${input.status}`,
      });

      return {
        data: {
          total: insightPage.total,
          status: input.status,
          insights,
          pendingRecommendations: pendingRecommendations?.items.map((recommendation) => ({
            id: recommendation.id,
            insightId: recommendation.insightId,
            title: recommendation.title,
            description: recommendation.description,
            priority: recommendation.priority,
            actionType: recommendation.actionType,
          })),
        },
        sources,
      };
    },
  });
}
