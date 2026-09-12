import { z } from 'zod';
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
  limit: z.number().int().min(1).max(30).optional().default(10),
});

export function createGetCustomerVoiceTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_customer_voice',
    description:
      'Voz do cliente: mix por intenção (reclamação, entrega, preço, cancelamento, intenção de compra, ' +
      'suporte, elogio), sentimento médio vs. período anterior, mensagens urgentes, temas frequentes, ' +
      'produtos mais citados negativamente e amostras. Use para "o que os clientes estão falando?", ' +
      '"tem alguém querendo cancelar?", "quais produtos geram reclamação?".',
    inputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);
      const data = await deps.analytics.getCustomerVoice(ctx, period, input.limit);
      const serialized = serializePeriod(period);

      const complaintCount = await deps.metrics.calculate(ctx, 'complaint_count', {
        period,
        withComparison: true,
      });

      const sources: MessageSource[] = [
        sourceFromMetric(complaintCount, 'get_customer_voice'),
        {
          metric: 'interactions',
          period: serialized,
          value: data.totals.interactions,
          tool: 'get_customer_voice',
          label: `${data.totals.interactions} interação(ões) no período`,
        },
        {
          metric: 'negative_interactions',
          period: serialized,
          value: data.totals.negative,
          tool: 'get_customer_voice',
          label: `${data.totals.negative} interação(ões) negativas no período`,
        },
      ];
      if (data.totals.avgSentiment != null) {
        sources.push({
          metric: 'avg_sentiment',
          period: serialized,
          value: Math.round(data.totals.avgSentiment * 100) / 100,
          tool: 'get_customer_voice',
          label: 'sentimento médio das interações classificadas',
        });
      }

      for (const sample of [...data.urgent.slice(0, 2), ...data.samples.slice(0, 3)]) {
        sources.push({
          metric: 'interactions',
          period: serialized,
          tool: 'get_customer_voice',
          refId: sample.id,
          excerpt: sample.excerpt,
          label: `${sample.intent} via ${sample.channel}`,
        });
      }

      return { data, sources };
    },
  });
}
