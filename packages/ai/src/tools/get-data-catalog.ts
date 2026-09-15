import { z } from 'zod';
import { defineTool } from '../tool-registry';
import type { Tool, ToolResult } from '../types';
import type { ToolDeps } from './shared';

const inputSchema = z.object({
  entityType: z
    .enum(['customer', 'product', 'sale', 'sale_item'])
    .describe('Filtra o catálogo a uma entidade. Omita para listar todas.')
    .optional(),
});

export function createGetDataCatalogTool(deps: ToolDeps): Tool {
  return defineTool({
    name: 'get_data_catalog',
    description:
      'Lista entidades e campos disponíveis nesta empresa (canônicos e customizados), ' +
      'com tipo, descrição e se podem filtrar ou agregar. Use ANTES de query_business_data ' +
      'ou aggregate_business_data quando a pergunta citar um atributo específico do nicho ' +
      '(ex.: tipo de equipamento, horas técnicas). Não invente chaves que não estejam aqui.',
    inputSchema,
    async execute(ctx, input): Promise<ToolResult> {
      if (!deps.dataCatalog) {
        return { data: { entities: [], message: 'Catálogo indisponível.' }, sources: [] };
      }
      const catalog = await deps.dataCatalog.getCatalog(ctx, { entityType: input.entityType });
      return {
        data: catalog,
        sources: [
          {
            metric: 'data_catalog',
            tool: 'get_data_catalog',
            label: 'Catálogo de dados da empresa',
          },
        ],
      };
    },
  });
}
