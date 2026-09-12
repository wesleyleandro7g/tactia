import type { InsightRepository } from '@tactia/database';
import { computeScore, eventFingerprint } from './scoring';
import type { DetectedEvent } from './types';

export type InsightEngineOptions = {
  /** Max NEW insights persisted per run (highest score first). Default 15. */
  maxPerRun?: number;
  /** Findings dismissed as noise this many times are suppressed. Default 2. */
  suppressAfterDismissals?: number;
  /** Auto-resolve open insights whose finding disappeared. Default true. */
  autoResolve?: boolean;
};

export type ProcessResult = {
  created: string[];
  refreshed: string[];
  suppressed: number;
  resolved: number;
  /** Fingerprints that fired (whether created or refreshed). */
  active: string[];
};

/**
 * InsightEngine v2: turns DetectedEvents into Insight rows.
 *  - identity is the `fingerprint` (rule + entity): an open insight is refreshed
 *    with the new numbers instead of duplicated;
 *  - findings the user dismissed as noise repeatedly are suppressed;
 *  - open insights whose rule ran and did not fire are auto-resolved;
 *  - at most `maxPerRun` new insights are created per run, by score.
 */
export class InsightEngine {
  private readonly maxPerRun: number;
  private readonly suppressAfter: number;
  private readonly autoResolve: boolean;

  constructor(
    private readonly insights: InsightRepository,
    options: InsightEngineOptions = {},
  ) {
    this.maxPerRun = options.maxPerRun ?? 15;
    this.suppressAfter = options.suppressAfterDismissals ?? 2;
    this.autoResolve = options.autoResolve ?? true;
  }

  async processEvents(
    tenantId: string,
    events: DetectedEvent[],
    options: { evaluatedRuleKeys?: string[] } = {},
  ): Promise<ProcessResult> {
    const result: ProcessResult = {
      created: [],
      refreshed: [],
      suppressed: 0,
      resolved: 0,
      active: [],
    };

    const scored = events
      .map((event) => ({
        event,
        fingerprint: eventFingerprint(event),
        score: computeScore(event),
      }))
      .sort((a, b) => b.score - a.score);

    // One event per fingerprint per run (rules may overlap on the same entity).
    const seen = new Set<string>();

    for (const { event, fingerprint, score } of scored) {
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      const existing = await this.insights.findOpenByFingerprint({ tenantId, fingerprint });
      if (existing) {
        await this.insights.refresh(
          { id: existing.id, tenantId },
          {
            severity: event.severity,
            title: event.title,
            description: event.description,
            evidence: event.evidence,
            impactAmount: event.impactAmount ?? null,
            confidence: event.confidence ?? null,
            score,
            drivers: event.drivers,
            periodFrom: event.periodFrom,
            periodTo: event.periodTo,
          },
        );
        result.refreshed.push(existing.id);
        result.active.push(fingerprint);
        continue;
      }

      const dismissals = await this.insights.countDismissedByFingerprint({
        tenantId,
        fingerprint,
        reason: 'noise',
      });
      if (dismissals >= this.suppressAfter) {
        result.suppressed += 1;
        // Still counts as active: the condition exists, we just don't nag.
        result.active.push(fingerprint);
        continue;
      }

      if (result.created.length >= this.maxPerRun) {
        result.active.push(fingerprint);
        continue;
      }

      const insight = await this.insights.create({
        tenantId,
        type: event.type,
        severity: event.severity,
        title: event.title,
        description: event.description,
        ruleKey: event.ruleKey,
        evidence: event.evidence,
        periodFrom: event.periodFrom,
        periodTo: event.periodTo,
        fingerprint,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        impactAmount: event.impactAmount ?? null,
        confidence: event.confidence ?? null,
        score,
        drivers: event.drivers,
      });
      result.created.push(insight.id);
      result.active.push(fingerprint);
    }

    if (this.autoResolve && options.evaluatedRuleKeys && options.evaluatedRuleKeys.length > 0) {
      result.resolved = await this.insights.autoResolveNotIn({
        tenantId,
        ruleKeys: options.evaluatedRuleKeys,
        activeFingerprints: result.active,
      });
    }

    return result;
  }
}
