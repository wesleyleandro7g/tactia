import type { InsightRepository } from '@tactia/database';
import type { DetectedEvent } from './types';

/**
 * InsightEngine: converts DetectedEvents into persisted Insight records.
 * Deduplicates: does NOT recreate an open/acknowledged insight for the same
 * rule+period combination.
 */
export class InsightEngine {
  constructor(private readonly insights: InsightRepository) {}

  async processEvents(tenantId: string, events: DetectedEvent[]): Promise<string[]> {
    const created: string[] = [];

    for (const event of events) {
      const existing = await this.insights.findOpenByRuleAndPeriod({
        tenantId,
        ruleKey: event.ruleKey,
        periodFrom: event.periodFrom,
        periodTo: event.periodTo,
      });

      if (existing) continue;

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
      });

      created.push(insight.id);
    }

    return created;
  }
}
