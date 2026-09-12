import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { MessageSource, Tool } from '../types';
import type { ToolDeps } from './shared';

const inputSchema = z.object({
  insightId: z.string().uuid().describe('Id do insight (listado no contexto ou em get_insights).'),
});

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && 'toNumber' in (value as object)) {
    return (value as { toNumber(): number }).toNumber();
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createGetInsightDetailTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_insight_detail',
    description:
      'Detalhe completo de um insight: descrição, evidências numéricas, decomposição de causas ' +
      '(drivers), impacto estimado, entidade relacionada e recomendações com ação sugerida. ' +
      'Use para aprofundar um insight listado no contexto.',
    inputSchema,
    async execute(ctx, input) {
      const insight = await deps.insights.getById(ctx, input.insightId);
      const evidence = Array.isArray(insight.evidence)
        ? (insight.evidence as Array<{
            key: string;
            value: number;
            period: { from: string; to: string };
            comparison?: { value: number; change: number };
          }>)
        : [];

      const sources: MessageSource[] = evidence.map((item) => ({
        metric: item.key,
        period: item.period,
        value: item.value,
        tool: 'get_insight_detail',
        label: `${item.key} — evidência do insight`,
      }));
      sources.push({
        metric: 'insight',
        refId: insight.id,
        tool: 'get_insight_detail',
        label: insight.title,
        excerpt: insight.description,
      });

      return {
        data: {
          id: insight.id,
          ruleKey: insight.ruleKey,
          type: insight.type,
          severity: insight.severity,
          status: insight.status,
          title: insight.title,
          description: insight.description,
          period: { from: insight.periodFrom.toISOString(), to: insight.periodTo.toISOString() },
          entity:
            insight.entityType && insight.entityId
              ? { type: insight.entityType, id: insight.entityId }
              : null,
          impactAmount: toNumber(insight.impactAmount),
          confidence: insight.confidence,
          score: insight.score,
          drivers: insight.drivers ?? null,
          evidence,
          recommendations: insight.recommendations.map((rec) => ({
            id: rec.id,
            priority: rec.priority,
            status: rec.status,
            title: rec.title,
            description: rec.description,
            actionType: rec.actionType,
            metadata: rec.metadata,
          })),
          createdAt: insight.createdAt.toISOString(),
        },
        sources,
      };
    },
  });
}
