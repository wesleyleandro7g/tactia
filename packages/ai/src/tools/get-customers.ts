import { z } from 'zod';
import type { MetricResult } from '@tactia/intelligence';
import { defineTool } from '../tool-registry';
import type { Tool } from '../types';
import { periodInputSchema, resolvePeriod, sourceFromMetric, type ToolDeps } from './shared';

const inputSchema = periodInputSchema.extend({
  status: z
    .enum(['active', 'inactive', 'blocked'])
    .describe('Filtra a lista de clientes por status.')
    .optional(),
  search: z.string().min(1).max(120).describe('Busca por nome, e-mail ou documento.').optional(),
  limit: z
    .number()
    .int()
    .min(0)
    .max(50)
    .describe('Quantidade de clientes a listar (0 = apenas o total do período).')
    .optional()
    .default(10),
});

/**
 * get_customers — clientes únicos que compraram no período + lista de clientes.
 */
export function createGetCustomersTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_customers',
    description:
      'Retorna quantos clientes distintos compraram no período (métrica customer_count) e ' +
      'uma lista de clientes cadastrados, com filtro por status e busca por nome. ' +
      'Use para "quantos clientes compraram este mês?" ou "quais clientes estão inativos?".',
    inputSchema,
    async execute(ctx, input) {
      const period = resolvePeriod(input);

      const customerCount = (await deps.metrics.calculate(ctx, 'customer_count', {
        period,
        withComparison: true,
      })) as MetricResult;

      const list =
        input.limit > 0
          ? await deps.customers.list(ctx, {
              page: '1',
              pageSize: String(input.limit),
              status: input.status,
              search: input.search,
            })
          : null;

      return {
        data: {
          customerCount: {
            value: customerCount.value,
            period: customerCount.period,
            comparison: customerCount.comparison,
          },
          totalRegistered: list?.total,
          customers: list?.items.map((customer) => ({
            id: customer.id,
            name: customer.name,
            status: customer.status,
            email: customer.email,
            createdAt: customer.createdAt,
            customData: customer.customData ?? {},
          })),
        },
        sources: [sourceFromMetric(customerCount, 'get_customers')],
      };
    },
  });
}
