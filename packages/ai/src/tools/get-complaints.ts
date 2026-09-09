import { z } from 'zod';
import type { MetricResult } from '@tactia/intelligence';
import { defineTool } from '../tool-registry';
import type { MessageSource, Tool } from '../types';
import {
  periodInputSchema,
  resolvePeriod,
  serializePeriod,
  sourceFromMetric,
  type ToolDeps,
} from './shared';

const inputSchema = periodInputSchema.extend({
  customerId: z.string().uuid().describe('Filtra reclamações de um cliente.').optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .describe('Quantidade de trechos a devolver.')
    .optional()
    .default(10),
});

function excerpt(body: string, max = 240): string {
  const trimmed = body.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function isMetricResult(value: unknown): value is MetricResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as MetricResult).key === 'string' &&
    typeof (value as MetricResult).value === 'number'
  );
}

export function createGetComplaintsTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_complaints',
    description:
      'Retorna reclamações classificadas no período (intent = complaint): total, temas ' +
      'mais frequentes e trechos. Use para "o que o cliente reclamou este mês?" ou ' +
      '"quais reclamações tivemos?".',
    inputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);
      const serialized = serializePeriod(period);

      let complaintCount: MetricResult | null = null;
      try {
        complaintCount = (await deps.metrics.calculate(ctx, 'complaint_count', {
          period,
          withComparison: true,
        })) as MetricResult;
      } catch {
        complaintCount = null;
      }

      const list = await deps.interactions.list(ctx, {
        page: '1',
        pageSize: String(input.limit),
        intent: 'complaint',
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        ...(input.customerId ? { customerId: input.customerId } : {}),
      });

      const topicCounts = new Map<string, number>();
      const items = list.items.map((interaction) => {
        for (const topic of interaction.topics) {
          topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
        }
        return {
          id: interaction.id,
          occurredAt: interaction.occurredAt.toISOString(),
          channel: interaction.channel,
          customerId: interaction.customerId,
          subject: interaction.subject,
          excerpt: excerpt(interaction.body),
          topics: interaction.topics,
        };
      });

      const topTopics = [...topicCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 8)
        .map(([topic, count]) => ({ topic, count }));

      const sources: MessageSource[] = [];
      if (complaintCount && isMetricResult(complaintCount)) {
        sources.push(sourceFromMetric(complaintCount, 'get_complaints'));
      }
      sources.push({
        metric: 'complaints',
        period: serialized,
        value: list.total,
        tool: 'get_complaints',
        label: `${list.total} reclamação(ões) no período`,
      });
      for (const item of items.slice(0, 5)) {
        sources.push({
          metric: 'complaints',
          period: serialized,
          tool: 'get_complaints',
          refId: item.id,
          excerpt: item.excerpt,
          label: `reclamação ${item.channel}`,
        });
      }

      return {
        data: {
          total: list.total,
          period: serialized,
          topTopics,
          complaints: items,
          complaintCount,
        },
        sources,
      };
    },
  });
}
