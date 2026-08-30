import type { PrismaClient } from '@tactia/database';
import type { InsightRepository, RecommendationRepository } from '@tactia/database';
import {
  DEFAULT_THRESHOLDS,
  InsightEngine,
  MetricEngine,
  RecommendationEngine,
  RuleEngine,
  type TenantThresholds,
} from '@tactia/intelligence';
import type { AuditLogService } from './audit-log-service';
import { AuditAction } from './audit-log-service';
import { logger } from '@tactia/shared';

export type RunPipelineOptions = {
  tenantId: string;
  /** Override the analysis period. Defaults to the last 30 days. */
  periodFrom?: Date;
  periodTo?: Date;
  /** Tenant-level threshold overrides */
  thresholds?: Partial<TenantThresholds>;
  /** RequestContext-like for audit logging */
  actorCtx?: { tenantId: string | null; userId?: string | null; ip?: string | null };
};

export type PipelineResult = {
  eventsDetected: number;
  insightsCreated: number;
  recommendationsCreated: number;
};

/**
 * IntelligencePipelineService orchestrates:
 *   RuleEngine → InsightEngine → RecommendationEngine
 *
 * Called on-demand via the API or after each sync completes (pg-boss hook
 * added at the apps/web layer without modifying the domain).
 */
export class IntelligencePipelineService {
  private readonly ruleEngine: RuleEngine;
  private readonly insightEngine: InsightEngine;
  private readonly recommendationEngine: RecommendationEngine;

  constructor(
    private readonly db: PrismaClient,
    private readonly insights: InsightRepository,
    private readonly recommendations: RecommendationRepository,
    private readonly auditLogs: AuditLogService,
  ) {
    const metricEngine = new MetricEngine(db);
    this.ruleEngine = new RuleEngine(metricEngine);
    this.insightEngine = new InsightEngine(insights);
    this.recommendationEngine = new RecommendationEngine(recommendations, insights);
  }

  async run(options: RunPipelineOptions): Promise<PipelineResult> {
    const { tenantId, thresholds } = options;

    // Default period: last 30 days
    const periodTo = options.periodTo ?? new Date();
    const periodFrom =
      options.periodFrom ?? new Date(periodTo.getTime() - 30 * 24 * 60 * 60 * 1000);

    const mergedThresholds: TenantThresholds = {
      ...DEFAULT_THRESHOLDS,
      ...thresholds,
    };

    logger.info({ tenant_id: tenantId, operation: 'intelligence_pipeline_start' });

    // 1. Evaluate rules
    const events = await this.ruleEngine.evaluate({
      tenantId,
      period: { from: periodFrom, to: periodTo },
      db: this.db,
      thresholds: mergedThresholds,
    });

    // 2. Persist insights (with deduplication)
    const createdInsightIds = await this.insightEngine.processEvents(tenantId, events);

    // 3. Audit: INSIGHT_CREATED per new insight
    for (const insightId of createdInsightIds) {
      await this.auditLogs.record(
        { tenantId, userId: options.actorCtx?.userId ?? null, ip: options.actorCtx?.ip ?? null },
        {
          action: AuditAction.INSIGHT_CREATED,
          entityType: 'insight',
          entityId: insightId,
          actorType: 'system',
        },
      );
    }

    // 4. Generate recommendations
    const beforeCount = await this.db.recommendation.count({ where: { tenantId } });
    await this.recommendationEngine.generateForInsights(tenantId, createdInsightIds);
    const afterCount = await this.db.recommendation.count({ where: { tenantId } });

    const result: PipelineResult = {
      eventsDetected: events.length,
      insightsCreated: createdInsightIds.length,
      recommendationsCreated: afterCount - beforeCount,
    };

    logger.info({
      tenant_id: tenantId,
      operation: 'intelligence_pipeline_complete',
      ...result,
    });

    return result;
  }
}
