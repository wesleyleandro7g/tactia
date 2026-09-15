import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { Tool, ToolResult } from '../types';
import type { ToolDeps } from './shared';

const filterSchema = z.object({
  field: z.string().min(1).max(80),
  operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'is_null']),
  value: z.unknown().optional(),
});

const inputSchema = z.object({
  entityType: z.enum(['customer', 'product', 'sale', 'sale_item']),
  metrics: z
    .array(
      z.object({
        op: z.enum(['count', 'sum', 'avg', 'min', 'max']),
        field: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe('Campo numérico do catálogo. Omita para count.'),
      }),
    )
    .min(1)
    .max(8),
  groupBy: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe('Campo canônico ou customizado para agrupar (ex.: equipment_type).'),
  filters: z.array(filterSchema).max(20).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export function createAggregateBusinessDataTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'aggregate_business_data',
    description:
      'Agrega no banco (count/sum/avg/min/max) sobre campos canônicos ou customizados. ' +
      'Use para "quantos por tipo", "soma de horas", etc. Não some na cabeça a partir de ' +
      'query_business_data. group_by e field precisam existir no get_data_catalog e ser agregáveis.',
    inputSchema,
    async execute(ctx, input): Promise<ToolResult> {
      if (!deps.structuredQuery) {
        return { data: { error: 'Agregação estruturada indisponível.' }, sources: [] };
      }
      const result = await deps.structuredQuery.aggregate(ctx, input);
      return {
        data: result,
        sources: [
          {
            metric: `${input.entityType}_aggregate`,
            tool: 'aggregate_business_data',
            value: result.meta.count,
            label: `${input.entityType} — ${result.meta.count} grupo(s)`,
          },
        ],
      };
    },
  });
}
