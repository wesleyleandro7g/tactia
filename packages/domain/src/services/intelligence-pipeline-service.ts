import type { PrismaClient } from '@tactia/database';
import type { InsightRepository, RecommendationRepository } from '@tactia/database';
import {
  DEFAULT_THRESHOLDS,
  InsightEngine,
  MetricEngine,
  RecommendationEngine,
  RuleEngine,
  SnapshotEngine,
  type RuleFact,
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
  /** Skip snapshot materialization (e.g. when the daily job already did it). */
  skipSnapshots?: boolean;
};

export type PipelineResult = {
  snapshotDays: number;
  eventsDetected: number;
  insightsCreated: number;
  insightsRefreshed: number;
  insightsResolved: number;
  insightsSuppressed: number;
  recommendationsCreated: number;
};

/** Optional providers the pipeline consults per tenant (Etapa 12). */
export type PipelineProviders = {
  /** Tenant threshold overrides (settings + calibration). */
  thresholds?: (tenantId: string) => Promise<Partial<TenantThresholds>>;
  /** Business facts/events used to suppress findings. */
  facts?: (tenantId: string) => Promise<RuleFact[]>;
  /** Shared snapshot engine (so the pipeline and analytics read the same instance). */
  snapshots?: SnapshotEngine;
};

/**
 * IntelligencePipelineService orchestrates:
 *   RuleEngine → InsightEngine → RecommendationEngine
 *
 * Called on-demand via the API, after each sync completes, and by the daily
 * scheduler.
 */
export class IntelligencePipelineService {
  private readonly ruleEngine: RuleEngine;
  private readonly insightEngine: InsightEngine;
  private readonly recommendationEngine: RecommendationEngine;
  private readonly snapshots: SnapshotEngine;

  constructor(
    private readonly db: PrismaClient,
    private readonly insights: InsightRepository,
    private readonly recommendations: RecommendationRepository,
    private readonly auditLogs: AuditLogService,
    private readonly providers: PipelineProviders = {},
  ) {
    const metricEngine = new MetricEngine(db);
    this.snapshots = providers.snapshots ?? new SnapshotEngine(db, metricEngine);
    this.ruleEngine = new RuleEngine(metricEngine, { snapshots: this.snapshots });
    this.insightEngine = new InsightEngine(insights);
    this.recommendationEngine = new RecommendationEngine(recommendations, insights);
  }

  /**
   * Step 0 — keep daily snapshots fresh so baselines/trends have history.
   * Never fails the pipeline: rules fall back to live aggregation.
   */
  private async materializeSnapshots(tenantId: string): Promise<number> {
    try {
      const result = await this.snapshots.run(tenantId);
      return result.days;
    } catch (error) {
      logger.warn({
        tenant_id: tenantId,
        operation: 'metric_snapshots_failed',
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Standard analysis windows for the daily job: last 7 days, last 30 days and
   * month-to-date. Events from every window are merged before persisting, so
   * one finding (fingerprint) keeps its strongest evidence and auto-resolve
   * only removes insights no window detected.
   */
  static dailyWindows(now = new Date()): Array<{ from: Date; to: Date; label: string }> {
    const day = 24 * 60 * 60 * 1000;
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const windows = [
      { label: '7d', from: new Date(now.getTime() - 7 * day), to: now },
      { label: '30d', from: new Date(now.getTime() - 30 * day), to: now },
    ];
    // MTD only adds signal after a few days into the month.
    if (now.getTime() - monthStart.getTime() >= 3 * day) {
      windows.push({ label: 'mtd', from: monthStart, to: now });
    }
    return windows;
  }

  async run(options: RunPipelineOptions): Promise<PipelineResult> {
    // Default period: last 30 days
    const periodTo = options.periodTo ?? new Date();
    const periodFrom =
      options.periodFrom ?? new Date(periodTo.getTime() - 30 * 24 * 60 * 60 * 1000);

    return this.runWindows({ ...options, windows: [{ from: periodFrom, to: periodTo }] });
  }

  /** Evaluate rules over several windows and persist the merged findings once. */
  async runWindows(
    options: Omit<RunPipelineOptions, 'periodFrom' | 'periodTo'> & {
      windows: Array<{ from: Date; to: Date }>;
    },
  ): Promise<PipelineResult> {
    const { tenantId } = options;
    if (options.windows.length === 0) {
      throw new Error('runWindows requires at least one window');
    }

    const [tenant, providerThresholds, facts] = await Promise.all([
      this.db.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
      this.providers.thresholds?.(tenantId) ?? Promise.resolve({}),
      this.providers.facts?.(tenantId) ?? Promise.resolve([]),
    ]);

    const mergedThresholds: TenantThresholds = {
      ...DEFAULT_THRESHOLDS,
      ...providerThresholds,
      ...options.thresholds,
    };

    logger.info({ tenant_id: tenantId, operation: 'intelligence_pipeline_start' });

    // 0. Snapshots (history for baselines/trends)
    const snapshotDays = options.skipSnapshots ? 0 : await this.materializeSnapshots(tenantId);

    // 1. Evaluate rules (sequentially per window to bound DB load)
    const events = [];
    for (const window of options.windows) {
      const detected = await this.ruleEngine.evaluate({
        tenantId,
        period: { from: window.from, to: window.to },
        db: this.db,
        thresholds: mergedThresholds,
        currency: tenant?.currency ?? 'BRL',
        facts,
      });
      events.push(...detected);
    }

    // 2. Persist insights (dedup by fingerprint, refresh, suppress, auto-resolve)
    const processed = await this.insightEngine.processEvents(tenantId, events, {
      evaluatedRuleKeys: this.ruleEngine.ruleKeys(),
    });

    // 3. Audit: INSIGHT_CREATED per new insight
    for (const insightId of processed.created) {
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
    await this.recommendationEngine.generateForInsights(tenantId, processed.created);
    const afterCount = await this.db.recommendation.count({ where: { tenantId } });

    const result: PipelineResult = {
      snapshotDays,
      eventsDetected: events.length,
      insightsCreated: processed.created.length,
      insightsRefreshed: processed.refreshed.length,
      insightsResolved: processed.resolved,
      insightsSuppressed: processed.suppressed,
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
