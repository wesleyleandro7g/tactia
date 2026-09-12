import type { Rule } from './types';
import { revenueConcentrationRule, revenueDropRule, revenueGrowthRule } from './revenue';
import { productChangesRule, productDeclineWithComplaintsRule } from './products';
import { churnRiskWithComplaintRule, customerChurnRiskRule } from './customers';
import { hotLeadStalledRule, inactiveLeadsRule } from './leads';
import { sellerHighDiscountLowMarginRule, sellerPerformanceDeviationRule } from './sellers';
import { cancellationRateRule, discountShareRule, marginDropRule } from './sales-health';
import { complaintVolumeRule, unansweredInteractionsRule } from './interactions';
import { staleDataRule } from './data';
import { goalPaceBehindRule, goalReachedRule } from './goals';
import { funnelBottleneckRule, leadVelocityDropRule } from './funnel';
import { championsAtRiskRule, retentionDropRule } from './retention';
import {
  customerOverdueWithNewSaleRule,
  expenseSpikeRule,
  negativeOperatingProfitRule,
  overdueSpikeRule,
} from './finance';
import { deadStockRule, stockoutRiskRule } from './inventory';
import { cacSpikeRule, campaignWithoutLeadsRule } from './acquisition';

export type { Rule, RuleContext, RuleInput, RuleFact } from './types';
export { findChurnRiskCustomers, type ChurnRiskCustomer } from './customers';

/** Rule keys a single rule may emit (product_changes emits growth and decline). */
export const RULE_KEYS_BY_RULE: Record<string, string[]> = {
  product_changes: ['product_growth', 'product_decline'],
};

export const DEFAULT_RULES: Rule[] = [
  revenueDropRule,
  revenueGrowthRule,
  revenueConcentrationRule,
  productChangesRule,
  productDeclineWithComplaintsRule,
  customerChurnRiskRule,
  churnRiskWithComplaintRule,
  inactiveLeadsRule,
  hotLeadStalledRule,
  sellerPerformanceDeviationRule,
  sellerHighDiscountLowMarginRule,
  marginDropRule,
  discountShareRule,
  cancellationRateRule,
  complaintVolumeRule,
  unansweredInteractionsRule,
  staleDataRule,
  goalPaceBehindRule,
  goalReachedRule,
  funnelBottleneckRule,
  leadVelocityDropRule,
  retentionDropRule,
  championsAtRiskRule,
  expenseSpikeRule,
  negativeOperatingProfitRule,
  overdueSpikeRule,
  customerOverdueWithNewSaleRule,
  stockoutRiskRule,
  deadStockRule,
  cacSpikeRule,
  campaignWithoutLeadsRule,
];

/** Every insight ruleKey the default rule set can produce. */
export function ruleKeysOf(rules: Rule[]): string[] {
  const keys = new Set<string>();
  for (const rule of rules) {
    if (rule.autoResolve === false) continue;
    for (const key of RULE_KEYS_BY_RULE[rule.key] ?? [rule.key]) keys.add(key);
  }
  return [...keys];
}
