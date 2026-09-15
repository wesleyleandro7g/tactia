import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { Tool, ToolResult } from '../types';
import type { ToolDeps } from './shared';

const filterSchema = z.object({
  field: z.string().min(1).max(80).describe('Chave do campo no catálogo (canônico ou customizado).'),
  operator: z
    .enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'is_null'])
    .describe('Operador. Deve ser válido para o tipo do campo.'),
  value: z.unknown().optional().describe('Valor do filtro. Omita para is_null.'),
});

const inputSchema = z.object({
  entityType: z.enum(['customer', 'product', 'sale', 'sale_item']),
  fields: z
    .array(z.string().min(1).max(80))
    .max(40)
    .optional()
    .describe('Campos a retornar. Use chaves do get_data_catalog.'),
  filters: z.array(filterSchema).max(20).optional(),
  limit: z.number().int().min(1).max(100).optional().describe('Máximo de linhas (padrão 50, teto 100).'),
});

export function createQueryBusinessDataTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'query_business_data',
    description:
      'Consulta registros de uma entidade (clientes, produtos, vendas ou itens) com filtros ' +
      'estruturados, incluindo campos customizados. Não envia SQL. Prefira as tools específicas ' +
      '(get_revenue, get_sales, get_customers) para métricas canônicas. Use get_data_catalog ' +
      'se não souber o nome do campo. Limite baixo — não peça milhares de linhas.',
    inputSchema,
    async execute(ctx, input): Promise<ToolResult> {
      if (!deps.structuredQuery) {
        return { data: { error: 'Consulta estruturada indisponível.' }, sources: [] };
      }
      const result = await deps.structuredQuery.query(ctx, input);
      return {
        data: result,
        sources: [
          {
            metric: `${input.entityType}_query`,
            tool: 'query_business_data',
            value: result.meta.count,
            label: `${input.entityType} — ${result.meta.count} registro(s)`,
          },
        ],
      };
    },
  });
}
