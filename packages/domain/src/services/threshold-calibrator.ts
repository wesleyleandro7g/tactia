import type { InsightFeedbackRepository, TenantSettingsRepository } from '@tactia/database';
import {
  DEFAULT_THRESHOLDS,
  THRESHOLD_KEYS,
  type TenantThresholds,
} from '@tactia/intelligence';

/** Maps insight rule keys to the threshold they fire on. */
export const RULE_THRESHOLD_KEY: Record<string, keyof TenantThresholds> = {
  revenue_drop: 'revenueDrop',
  revenue_growth: 'revenueGrowth',
  product_growth: 'productChange',
  product_decline: 'productChange',
  inactive_leads: 'inactiveLeadDays',
  inactive_customers: 'inactiveCustomerDays',
  customer_churn_risk: 'churnIntervalFactor',
  seller_performance_deviation: 'sellerDeviationFactor',
  complaint_volume: 'complaintGrowth',
  hot_lead_stalled: 'hotLeadScore',
  margin_drop: 'marginDrop',
  discount_share: 'discountShare',
  cancellation_rate: 'cancellationRate',
  unanswered_interactions: 'unansweredHours',
  stale_data: 'staleDataHours',
  revenue_concentration: 'revenueConcentration',
  goal_pace_behind: 'goalPaceTolerance',
  retention_drop: 'retentionDrop',
  stockout_risk: 'stockCoverDays',
  dead_stock: 'deadStockDays',
  expense_spike: 'expenseSpike',
  overdue_spike: 'overdueShare',
  cac_spike: 'cacSpike',
  funnel_bottleneck: 'funnelStallDays',
};

const FEEDBACK_WINDOW_DAYS = 90;
const NOISE_MIN = 3;
const USEFUL_MIN = 3;
const STEP = 1.2;
const CAP = 2;

function asThresholds(value: unknown): Partial<TenantThresholds> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const out: Partial<TenantThresholds> = {};
  for (const key of THRESHOLD_KEYS) {
    const n = raw[key];
    if (typeof n === 'number' && Number.isFinite(n)) out[key] = n;
  }
  return out;
}

/** Raise a threshold (make the rule harder to fire), preserving sign. Capped at 2× default. */
export function loosenThreshold(current: number, defaultValue: number): number {
  const next = current * STEP;
  const cap = defaultValue * CAP;
  return defaultValue < 0 ? Math.max(next, cap) : Math.min(next, cap);
}

/**
 * Learns from insight thumbs: 3+ "não útil" loosens the rule's threshold by 20%
 * (capped at 2× the default). 3+ "útil" keeps the current value.
 */
export class ThresholdCalibrator {
  constructor(
    private readonly feedback: InsightFeedbackRepository,
    private readonly settings: TenantSettingsRepository,
  ) {}

  async calibrate(tenantId: string): Promise<Partial<TenantThresholds>> {
    const settings = await this.settings.getOrCreate(tenantId);
    const current = { ...asThresholds(settings.thresholds) };
    const since = new Date(Date.now() - FEEDBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const counts = await this.feedback.countByRuleVerdict({ tenantId, since });

    const next: Partial<TenantThresholds> = { ...current };
    let changed = false;

    for (const row of counts) {
      const key = RULE_THRESHOLD_KEY[row.ruleKey];
      if (!key) continue;
      if (row.useful >= USEFUL_MIN) continue;
      if (row.noise < NOISE_MIN) continue;
      const baseline = current[key] ?? DEFAULT_THRESHOLDS[key];
      const loosened = loosenThreshold(baseline, DEFAULT_THRESHOLDS[key]);
      if (loosened !== baseline) {
        next[key] = loosened;
        changed = true;
      }
    }

    if (changed) await this.settings.updateThresholds(tenantId, next);
    return next;
  }
}
