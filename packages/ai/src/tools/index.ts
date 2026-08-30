import { ToolRegistry } from '../tool-registry';
import type { Tool } from '../types';
import { createGetCustomersTool } from './get-customers';
import { createGetInsightsTool } from './get-insights';
import { createGetProductsTool } from './get-products';
import { createGetRevenueTool } from './get-revenue';
import { createGetSalesTool } from './get-sales';
import { createGetSellersTool } from './get-sellers';
import { createProposeActionTool, type ActionProposalPort } from './propose-action';
import type { ToolDeps } from './shared';

export { createGetCustomersTool } from './get-customers';
export { createGetInsightsTool } from './get-insights';
export { createGetProductsTool } from './get-products';
export { createGetRevenueTool } from './get-revenue';
export { createGetSalesTool } from './get-sales';
export { createGetSellersTool } from './get-sellers';
export {
  createProposeActionTool,
  PROPOSABLE_ACTION_TYPES,
  type ActionProposalPort,
} from './propose-action';
export {
  currentMonthPeriod,
  periodInputSchema,
  periodLabel,
  resolvePeriod,
  serializePeriod,
  sourceFromMetric,
  type ToolDeps,
} from './shared';

export type CreateToolsOptions = {
  /**
   * When provided, `propose_action` is registered so the assistant can propose
   * actions for human approval (Etapa 7). Omit it to keep the chat read-only.
   */
  actionProposer?: ActionProposalPort;
};

/** The 6 read tools of V0.1 (plan — Etapa 6) + propose_action (Etapa 7). */
export function createDefaultTools(deps: ToolDeps, options: CreateToolsOptions = {}): Tool[] {
  const tools = [
    createGetRevenueTool(deps),
    createGetSalesTool(deps),
    createGetCustomersTool(deps),
    createGetProductsTool(deps),
    createGetSellersTool(deps),
    createGetInsightsTool(deps),
  ];

  if (options.actionProposer) {
    tools.push(createProposeActionTool(options.actionProposer));
  }

  return tools;
}

export function createDefaultToolRegistry(
  deps: ToolDeps,
  options: CreateToolsOptions = {},
): ToolRegistry {
  return new ToolRegistry(createDefaultTools(deps, options));
}
