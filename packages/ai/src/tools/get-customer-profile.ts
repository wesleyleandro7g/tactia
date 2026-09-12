import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { MessageSource, Tool } from '../types';
import { periodInputSchema, resolvePeriod, serializePeriod, type ToolDeps } from './shared';

const inputSchema = periodInputSchema
  .extend({
    customerId: z.string().uuid().describe('UUID do cliente.').optional(),
    search: z
      .string()
      .min(1)
      .max(120)
      .describe('Busca por nome, e-mail ou documento quando customerId não é conhecido.')
      .optional(),
  })
  .refine((data) => data.customerId || data.search, {
    message: 'Informe customerId ou search.',
  });

export function createGetCustomerProfileTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_customer_profile',
    description:
      'Visão 360º de um cliente: LTV, última compra, produtos mais comprados, ' +
      'interações, atividades e leads vinculados. Use para "me fale sobre o cliente X".',
    inputSchema,
    async execute(ctx, input): Promise<import('../types').ToolResult> {
      const period = resolvePeriod(input);
      let customerId = input.customerId;

      if (!customerId && input.search) {
        const list = await deps.customers.list(ctx, {
          page: '1',
          pageSize: '5',
          search: input.search,
        });
        if (list.items.length === 0) {
          return {
            data: { found: false, message: 'Nenhum cliente encontrado para a busca.' },
            sources: [],
          };
        }
        customerId = list.items[0]!.id;
      }

      const profile = await deps.analytics.getCustomerProfile(ctx, customerId!, period);
      const serialized = serializePeriod(period);
      const sources: MessageSource[] = [
        {
          metric: 'customer_profile',
          period: serialized,
          value: profile.lifetime.ltv,
          tool: 'get_customer_profile',
          refId: profile.customer.id,
          label: `${profile.customer.name} — LTV ${profile.lifetime.ltv}`,
        },
      ];

      return { data: { found: true, ...profile }, sources };
    },
  });
}
