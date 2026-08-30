import { ToolRegistry } from '../tool-registry';
import type { Tool } from '../types';
import { createGetCustomersTool } from './get-customers';
import { createGetInsightsTool } from './get-insights';
import { createGetProductsTool } from './get-products';
import { createGetRevenueTool } from './get-revenue';
import { createGetSalesTool } from './get-sales';
import { createGetSellersTool } from './get-sellers';
import type { ToolDeps } from './shared';

export { createGetCustomersTool } from './get-customers';
export { createGetInsightsTool } from './get-insights';
export { createGetProductsTool } from './get-products';
export { createGetRevenueTool } from './get-revenue';
export { createGetSalesTool } from './get-sales';
export { createGetSellersTool } from './get-sellers';
export {
  currentMonthPeriod,
  periodInputSchema,
  periodLabel,
  resolvePeriod,
  serializePeriod,
  sourceFromMetric,
  type ToolDeps,
} from './shared';

/** The 6 tools of V0.1 (plan — Etapa 6). */
export function createDefaultTools(deps: ToolDeps): Tool[] {
  return [
    createGetRevenueTool(deps),
    createGetSalesTool(deps),
    createGetCustomersTool(deps),
    createGetProductsTool(deps),
    createGetSellersTool(deps),
    createGetInsightsTool(deps),
  ];
}

export function createDefaultToolRegistry(deps: ToolDeps): ToolRegistry {
  return new ToolRegistry(createDefaultTools(deps));
}
