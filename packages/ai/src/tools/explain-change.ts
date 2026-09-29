import { z } from 'zod';
import { DECOMPOSABLE_METRICS } from '@tactia/intelligence';
import { defineTool } from '../tool-registry';
import type { Tool } from '../types';
import { periodInputSchema, resolvePeriod, serializePeriod, type ToolDeps } from './shared';

const inputSchema = periodInputSchema.extend({
  metric: z
    .enum(DECOMPOSABLE_METRICS)
    .optional()
    .default('revenue')
    .describe('Métrica a explicar: revenue (padrão), sales_count, units_sold, discount_total, gross_margin.'),
  compareFrom: z
    .string()
    .optional()
    .describe('Início do período base (ISO). Padrão: período anterior de mesma duração.'),
  compareTo: z.string().optional().describe('Fim exclusivo do período base (ISO).'),
  dimensions: z
    .array(z.enum(['customer', 'product', 'seller', 'category', 'channel', 'region']))
    .optional()
    .describe('Dimensões a decompor. Padrão: todas.'),
  topN: z.number().int().min(1).max(15).optional().default(5),
});

export function createExplainChangeTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'explain_change',
    description:
      'Explica POR QUE uma métrica mudou entre um período e sua base: decompõe a variação em ' +
      'contribuidores por cliente, produto, vendedor e categoria (com R$ e % da variação), ' +
      'e para receita separa efeito preço × volume × mix. Sempre use em perguntas de causa ' +
      '("por que caiu?", "o que explica?", "de onde veio o crescimento?").',
    inputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);
      const comparePeriod =
        input.compareFrom && input.compareTo
          ? resolvePeriod({ from: input.compareFrom, to: input.compareTo })
          : undefined;
      const drivers = await deps.analytics.explainChange(ctx, {
        metric: input.metric,
        period,
        comparePeriod,
        dimensions: input.dimensions,
        topN: input.topN,
      });

      return {
        data: drivers,
        sources: [
          {
            metric: input.metric,
            period: serializePeriod(period),
            value: drivers.current,
            tool: 'explain_change',
            label: `${input.metric} no período analisado`,
            numericEvidence: [
              { value: drivers.current, unit: 'number', kind: 'observed', metric: input.metric, period: serializePeriod(period) },
              { value: drivers.delta, unit: 'number', kind: 'observed', metric: input.metric, period: serializePeriod(period) },
              { value: drivers.change * 100, unit: 'percent', kind: 'observed', metric: input.metric, period: serializePeriod(period) },
              ...drivers.byDimension.flatMap((dimension) => dimension.contributors.flatMap((contributor) => [
                ...[contributor.current, contributor.previous, contributor.delta].map((value) => ({ value, unit: 'number' as const, kind: 'observed' as const, metric: input.metric, period: serializePeriod(period) })),
                { value: contributor.share * 100, unit: 'percent' as const, kind: 'observed' as const, metric: input.metric, period: serializePeriod(period) },
              ])),
              ...(drivers.priceVolumeMix ? Object.values(drivers.priceVolumeMix).map((value) => ({ value, unit: 'number' as const, kind: 'observed' as const, metric: input.metric, period: serializePeriod(period) })) : []),
            ],
          },
          {
            metric: input.metric,
            period: drivers.comparisonPeriod,
            value: drivers.previous,
            tool: 'explain_change',
            label: `${input.metric} no período base`,
          },
        ],
      };
    },
  });
}
