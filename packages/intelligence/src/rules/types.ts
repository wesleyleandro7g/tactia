import type { PrismaClient } from '@tactia/database';
import type { BaselineProvider, BaselineQuery, BaselineStats } from '../baseline';
import type { MetricEngine } from '../metric-engine';
import type { DecomposeInput } from '../variance-decomposition';
import type { DetectedEvent, Drivers, MetricPeriod, TenantThresholds } from '../types';

/** What the caller must provide to evaluate rules. */
export type RuleInput = {
  tenantId: string;
  period: MetricPeriod;
  db: PrismaClient;
  thresholds: TenantThresholds;
  /** Tenant currency for formatted texts. Default BRL. */
  currency?: string;
  /**
   * Business facts/events declared by the user (Etapa 12). Rules may use them
   * to suppress findings (e.g. a seller that left the company).
   */
  facts?: RuleFact[];
};

export type RuleFact = {
  kind: 'fact' | 'event' | 'preference';
  text: string;
  entityType?: string | null;
  entityId?: string | null;
  validFrom?: Date | null;
  validTo?: Date | null;
};

/** Full context handed to each rule (input + engines). */
export type RuleContext = RuleInput & {
  metrics: MetricEngine;
  currency: string;
  decompose: (input: Omit<DecomposeInput, 'tenantId' | 'currency'>) => Promise<Drivers>;
  /** Previous period of the same duration. */
  previousPeriod: MetricPeriod;
  /** True when a fact suppresses findings about this entity. */
  isSuppressed: (entityType: string, entityId: string) => boolean;
  /** Statistical baseline from daily snapshots (null when history is short). */
  baseline: BaselineProvider;
  /** Convenience: baseline for the rule period (never throws — null on failure). */
  baselineFor: (query: Omit<BaselineQuery, 'period'> & { period?: MetricPeriod }) => Promise<BaselineStats | null>;
};

export type Rule = {
  key: string;
  /** Rules whose fingerprints participate in auto-resolve. Default true. */
  autoResolve?: boolean;
  evaluate(ctx: RuleContext): Promise<DetectedEvent[]>;
};

export function previousPeriodOf(p: MetricPeriod): MetricPeriod {
  const duration = p.to.getTime() - p.from.getTime();
  return {
    from: new Date(p.from.getTime() - duration),
    to: new Date(p.to.getTime() - duration),
  };
}

export function decimalToNumber(v: { toNumber(): number } | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return v.toNumber();
}

export const DAY_MS = 24 * 60 * 60 * 1000;
