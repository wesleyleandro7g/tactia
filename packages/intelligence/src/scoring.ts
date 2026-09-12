import type { DetectedEvent, InsightSeverityLiteral } from './types';

/** Urgency weight per severity. */
export const SEVERITY_WEIGHT: Record<InsightSeverityLiteral, number> = {
  critical: 1,
  high: 0.8,
  medium: 0.5,
  low: 0.3,
};

/** Score assigned to findings without a monetary impact, before weighting. */
export const NON_MONETARY_BASE_IMPACT = 250;

export const DEFAULT_CONFIDENCE = 0.5;

/**
 * Entity-level rules (product/seller/customer) only fire when the entity is
 * material: at least this share of the total, or this absolute amount.
 * Kills "+200% (R$ 10 → R$ 30)" noise.
 */
export const MATERIALITY = {
  minShareOfTotal: 0.02,
  minAbsoluteAmount: 500,
} as const;

export function isMaterial(
  entityValue: number,
  totalValue: number,
  options: { minShareOfTotal?: number; minAbsoluteAmount?: number } = {},
): boolean {
  const minShare = options.minShareOfTotal ?? MATERIALITY.minShareOfTotal;
  const minAbs = options.minAbsoluteAmount ?? MATERIALITY.minAbsoluteAmount;
  if (entityValue >= minAbs) return true;
  if (totalValue > 0 && entityValue / totalValue >= minShare) return true;
  return false;
}

/**
 * score = impact × confidence × urgency. Impact is the estimated money at
 * stake; when absent a small constant keeps non-monetary findings ranked by
 * severity/confidence only.
 */
export function computeScore(event: Pick<DetectedEvent, 'impactAmount' | 'confidence' | 'severity'>): number {
  const impact =
    event.impactAmount != null && event.impactAmount > 0
      ? event.impactAmount
      : NON_MONETARY_BASE_IMPACT;
  const confidence = clamp01(event.confidence ?? DEFAULT_CONFIDENCE);
  return Math.round(impact * confidence * SEVERITY_WEIGHT[event.severity] * 100) / 100;
}

/**
 * Confidence from sample size: 1 observation → ~0.3, 10 → ~0.75, 30+ → ~0.95.
 * Used by rules that compare aggregates (more sales = more trust in the change).
 */
export function confidenceFromSample(n: number): number {
  if (n <= 0) return 0.2;
  return clamp01(0.2 + 0.75 * (1 - Math.exp(-n / 10)));
}

export function eventFingerprint(event: Pick<DetectedEvent, 'ruleKey' | 'entityType' | 'entityId' | 'fingerprint'>): string {
  if (event.fingerprint) return event.fingerprint;
  if (!event.entityType && !event.entityId) return event.ruleKey;
  return `${event.ruleKey}:${event.entityType ?? ''}:${event.entityId ?? ''}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
