import { z } from 'zod';
import { CATALOG_SEARCH_LIMIT } from '@tactia/domain';
import { defineTool } from '../tool-registry';
import type { MessageSource, Tool } from '../types';
import type { ToolDeps } from './shared';

export function createSearchCatalogTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'search_catalog',
    description:
      'Busca semântica/keyword em produtos e clientes cadastrados (apelido, categoria, cidade). ' +
      'Não devolve receita. Para ranking por faturamento use get_products / get_customers.',
    inputSchema: z.object({
      query: z.string().min(1).max(500),
      entity: z.enum(['product', 'customer', 'both']).optional().default('both'),
      limit: z.number().int().min(1).max(20).optional().default(CATALOG_SEARCH_LIMIT),
    }),
    async execute(ctx, input) {
      if (!deps.catalog) {
        return {
          data: { query: input.query, mode: 'keyword' as const, products: [], customers: [] },
          sources: [] as MessageSource[],
        };
      }
      const result = await deps.catalog.search(ctx, {
        query: input.query,
        entity: input.entity,
        limit: input.limit,
      });
      const sources: MessageSource[] = [
        {
          metric: 'catalog',
          tool: 'search_catalog',
          label: `${result.products.length} produto(s), ${result.customers.length} cliente(s)`,
        },
      ];
      return {
        data: {
          query: input.query,
          mode: result.mode,
          products: result.products,
          customers: result.customers,
        },
        sources,
      };
    },
  });
}
