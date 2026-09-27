import { ToolRegistry } from '../tool-registry';
import type { Tool } from '../types';
import { createComparePeriodsTool } from './compare-periods';
import { createExplainChangeTool } from './explain-change';
import { createGetInsightDetailTool } from './get-insight-detail';
import { createGetTrendTool } from './get-trend';
import { createGetForecastTool } from './get-forecast';
import { createGetLatestBriefingTool } from './get-latest-briefing';
import { createGetComplaintsTool } from './get-complaints';
import { createGetCustomerProfileTool } from './get-customer-profile';
import { createGetCustomerSegmentsTool } from './get-customer-segments';
import { createGetCustomerVoiceTool } from './get-customer-voice';
import { createGetCustomersTool } from './get-customers';
import { createGetDataFreshnessTool } from './get-data-freshness';
import { createGetInsightsTool } from './get-insights';
import { createGetPeriodProjectionTool } from './get-period-projection';
import { createGetPipelineTool } from './get-pipeline';
import { createGetProductAffinityTool } from './get-product-affinity';
import { createGetProductPerformanceTool } from './get-product-performance';
import { createGetProductsTool } from './get-products';
import { createGetRevenueTool } from './get-revenue';
import { createGetSalesHealthTool } from './get-sales-health';
import { createGetSalesTool } from './get-sales';
import { createGetSellerPerformanceTool } from './get-seller-performance';
import { createGetSellersTool } from './get-sellers';
import { createSearchInteractionsTool } from './search-interactions';
import { createSearchDocumentsTool } from './search-documents';
import { createSearchCatalogTool } from './search-catalog';
import { createGetDataCatalogTool } from './get-data-catalog';
import { createQueryBusinessDataTool } from './query-business-data';
import { createAggregateBusinessDataTool } from './aggregate-business-data';
import {
  createGetPlaybookTool,
  createListPlaybooksTool,
  createSearchBusinessFactsTool,
  createSearchEpisodesTool,
} from './memory';
import { createProposeActionTool, type ActionProposalPort } from './propose-action';
import { createSendEmailTool, type DirectEmailPort } from './send-email';
import { createGenerateInfographicTool, type InfographicStore } from './generate-infographic';
import {
  createGetAcquisitionTool,
  createGetCashFlowTool,
  createGetCohortsTool,
  createGetFunnelTool,
  createGetGoalsProgressTool,
  createGetInventoryRiskTool,
  createGetProfitabilityTool,
  createGetRfmTool,
  createListBusinessFactsTool,
  createRememberFactTool,
  createSimulateTool,
} from './phase-cd';
import type { ToolDeps } from './shared';

export { createComparePeriodsTool } from './compare-periods';
export { createExplainChangeTool } from './explain-change';
export { createGetInsightDetailTool } from './get-insight-detail';
export { createGetTrendTool } from './get-trend';
export { createGetForecastTool } from './get-forecast';
export { createGetLatestBriefingTool } from './get-latest-briefing';
export {
  createGetAcquisitionTool,
  createGetCashFlowTool,
  createGetCohortsTool,
  createGetFunnelTool,
  createGetGoalsProgressTool,
  createGetInventoryRiskTool,
  createGetProfitabilityTool,
  createGetRfmTool,
  createListBusinessFactsTool,
  createRememberFactTool,
  createSimulateTool,
} from './phase-cd';
export { createGetComplaintsTool } from './get-complaints';
export { createGetCustomerProfileTool } from './get-customer-profile';
export { createGetCustomerSegmentsTool } from './get-customer-segments';
export { createGetCustomerVoiceTool } from './get-customer-voice';
export { createGetCustomersTool } from './get-customers';
export { createGetDataFreshnessTool } from './get-data-freshness';
export { createGetInsightsTool } from './get-insights';
export { createGetPeriodProjectionTool } from './get-period-projection';
export { createGetPipelineTool } from './get-pipeline';
export { createGetProductAffinityTool } from './get-product-affinity';
export { createGetProductPerformanceTool } from './get-product-performance';
export { createGetProductsTool } from './get-products';
export { createGetRevenueTool } from './get-revenue';
export { createGetSalesHealthTool } from './get-sales-health';
export { createGetSalesTool } from './get-sales';
export { createGetSellerPerformanceTool } from './get-seller-performance';
export { createGetSellersTool } from './get-sellers';
export { createSearchInteractionsTool } from './search-interactions';
export { createSearchDocumentsTool } from './search-documents';
export { createSearchCatalogTool } from './search-catalog';
export { createGetDataCatalogTool } from './get-data-catalog';
export { createQueryBusinessDataTool } from './query-business-data';
export { createAggregateBusinessDataTool } from './aggregate-business-data';
export {
  createGetPlaybookTool,
  createListPlaybooksTool,
  createSearchBusinessFactsTool,
  createSearchEpisodesTool,
} from './memory';
export {
  createProposeActionTool,
  PROPOSABLE_ACTION_TYPES,
  type ActionProposalPort,
} from './propose-action';
export { createSendEmailTool, type DirectEmailPort } from './send-email';
export {
  createGenerateInfographicTool,
  type InfographicStore,
} from './generate-infographic';
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
  /**
   * When provided, `send_email` is registered so the assistant can send an
   * e-mail directly (no approval) at the user's request. Chat-only — do not
   * pass it for the MCP registry, which must keep the approval guardrail.
   */
  directEmailSender?: DirectEmailPort;
  /**
   * When provided, `generate_infographic` is registered so the assistant can
   * attach branded PNGs to chat/WhatsApp answers.
   */
  infographicStore?: InfographicStore;
};

/** Read tools + analytics tools + optional propose_action (Etapa 7). */
export function createDefaultTools(deps: ToolDeps, options: CreateToolsOptions = {}): Tool[] {
  const tools = [
    createGetRevenueTool(deps),
    createGetSalesTool(deps),
    createGetCustomersTool(deps),
    createGetProductsTool(deps),
    createGetSellersTool(deps),
    createGetInsightsTool(deps),
    createGetComplaintsTool(deps),
    createSearchInteractionsTool(deps),
    createSearchDocumentsTool(deps),
    createSearchCatalogTool(deps),
    createGetDataCatalogTool(deps),
    createQueryBusinessDataTool(deps),
    createAggregateBusinessDataTool(deps),
    createGetCustomerProfileTool(deps),
    createGetPipelineTool(deps),
    createGetDataFreshnessTool(deps),
    createGetPeriodProjectionTool(deps),
    createGetProductPerformanceTool(deps),
    createGetSalesHealthTool(deps),
    createGetSellerPerformanceTool(deps),
    createGetCustomerVoiceTool(deps),
    createGetCustomerSegmentsTool(deps),
    createGetProductAffinityTool(deps),
    // Insights v2 — analytical tools
    createComparePeriodsTool(deps),
    createExplainChangeTool(deps),
    createGetTrendTool(deps),
    createGetInsightDetailTool(deps),
    createGetForecastTool(deps),
    createGetLatestBriefingTool(deps),
    createGetGoalsProgressTool(deps),
    createGetFunnelTool(deps),
    createRememberFactTool(deps),
    createListBusinessFactsTool(deps),
    createSearchBusinessFactsTool(deps),
    createSearchEpisodesTool(deps),
    createListPlaybooksTool(deps),
    createGetPlaybookTool(deps),
    createGetCohortsTool(deps),
    createGetRfmTool(deps),
    createSimulateTool(deps),
    createGetProfitabilityTool(deps),
    createGetCashFlowTool(deps),
    createGetInventoryRiskTool(deps),
    createGetAcquisitionTool(deps),
  ];

  if (options.actionProposer) {
    tools.push(createProposeActionTool(options.actionProposer));
  }
  if (options.directEmailSender) {
    tools.push(createSendEmailTool(options.directEmailSender));
  }
  if (options.infographicStore) {
    tools.push(createGenerateInfographicTool(options.infographicStore));
  }

  return tools;
}

export function createDefaultToolRegistry(
  deps: ToolDeps,
  options: CreateToolsOptions = {},
): ToolRegistry {
  return new ToolRegistry(createDefaultTools(deps, options));
}
