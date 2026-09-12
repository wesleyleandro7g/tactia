import { logger } from '@tactia/shared';
import { NULL_BASELINE_PROVIDER, SnapshotBaselineProvider, type BaselineProvider } from './baseline';
import { MetricEngine } from './metric-engine';
import type { SnapshotEngine } from './snapshot-engine';
import { DEFAULT_RULES, ruleKeysOf } from './rules';
import { previousPeriodOf, type Rule, type RuleContext, type RuleInput } from './rules/types';
import { eventFingerprint } from './scoring';
import { decomposeChange } from './variance-decomposition';
import type { DetectedEvent } from './types';

export type { RuleContext, RuleInput } from './rules/types';

/**
 * RuleEngine v2: evaluates a pluggable set of rules over a shared context
 * (metrics, decomposition, thresholds, business facts). Rules fail
 * independently — one broken rule never aborts the pipeline.
 */
export type RuleEngineOptions = {
  rules?: Rule[];
  /** Snapshot engine → statistical baseline for rules. */
  snapshots?: SnapshotEngine;
  /** Explicit provider (tests). Takes precedence over `snapshots`. */
  baseline?: BaselineProvider;
};

export class RuleEngine {
  private readonly rules: Rule[];
  private readonly baseline: BaselineProvider;

  constructor(
    private readonly engine: MetricEngine,
    options: RuleEngineOptions | Rule[] = {},
  ) {
    const opts: RuleEngineOptions = Array.isArray(options) ? { rules: options } : options;
    this.rules = opts.rules ?? DEFAULT_RULES;
    this.baseline =
      opts.baseline ??
      (opts.snapshots ? new SnapshotBaselineProvider(opts.snapshots) : NULL_BASELINE_PROVIDER);
  }

  /** Insight ruleKeys produced by this engine (drives auto-resolve). */
  ruleKeys(): string[] {
    return ruleKeysOf(this.rules);
  }

  buildContext(input: RuleInput): RuleContext {
    const currency = input.currency ?? 'BRL';
    const facts = input.facts ?? [];
    const now = Date.now();
    const suppressed = new Set(
      facts
        .filter((fact) => fact.entityType && fact.entityId)
        .filter((fact) => {
          const from = fact.validFrom?.getTime() ?? -Infinity;
          const to = fact.validTo?.getTime() ?? Infinity;
          return from <= now && now <= to;
        })
        .map((fact) => `${fact.entityType}:${fact.entityId}`),
    );

    return {
      ...input,
      currency,
      metrics: this.engine,
      previousPeriod: previousPeriodOf(input.period),
      decompose: (args) =>
        decomposeChange(input.db, { ...args, tenantId: input.tenantId, currency }),
      isSuppressed: (entityType, entityId) => suppressed.has(`${entityType}:${entityId}`),
      baseline: this.baseline,
      baselineFor: async (query) => {
        try {
          return await this.baseline.forMetric(input.tenantId, {
            ...query,
            period: query.period ?? input.period,
            anomalyZ: query.anomalyZ ?? input.thresholds.anomalyZScore,
          });
        } catch (error) {
          logger.warn(
            {
              tenant_id: input.tenantId,
              operation: 'baseline',
              metric: query.metric,
              err: error instanceof Error ? error.message : String(error),
            },
            'baseline unavailable',
          );
          return null;
        }
      },
    };
  }

  async evaluate(input: RuleInput): Promise<DetectedEvent[]> {
    const ctx = this.buildContext(input);
    const results = await Promise.allSettled(this.rules.map((rule) => rule.evaluate(ctx)));

    const events: DetectedEvent[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        for (const event of result.value) {
          events.push({ ...event, fingerprint: eventFingerprint(event) });
        }
      } else {
        logger.warn(
          {
            tenant_id: input.tenantId,
            operation: 'rule_evaluate',
            rule: this.rules[index]?.key,
            err: result.reason instanceof Error ? result.reason.message : String(result.reason),
          },
          'rule evaluation failed',
        );
      }
    });
    return events;
  }
}
