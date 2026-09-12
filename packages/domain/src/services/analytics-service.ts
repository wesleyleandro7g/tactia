import type { PrismaClient } from '@tactia/database';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import {
  AnalyticsEngine,
  METRIC_KEYS,
  SnapshotEngine,
  type DecompositionDimension,
  type MetricDimension,
  type MetricKey,
  type MetricPeriod,
} from '@tactia/intelligence';
import { assertTenantContext } from '../authz';

function assertMetricKey(metric: string): MetricKey {
  if (!(METRIC_KEYS as readonly string[]).includes(metric)) {
    throw new AppError(ErrorCode.NOT_FOUND, `Metric '${metric}' not found`);
  }
  return metric as MetricKey;
}

export class AnalyticsService {
  readonly engine: AnalyticsEngine;

  constructor(db: PrismaClient, snapshots?: SnapshotEngine) {
    this.engine = new AnalyticsEngine(db);
    // Trends/baselines read from daily snapshots when they cover the window.
    this.engine.useSeriesProvider((snapshots ?? new SnapshotEngine(db)).seriesProvider());
  }

  async comparePeriods(
    ctx: RequestContext,
    input: {
      metric: string;
      periodA: MetricPeriod;
      periodB: MetricPeriod;
      dimension?: Exclude<MetricDimension, 'time'>;
      limit?: number;
    },
  ) {
    assertTenantContext(ctx);
    return this.engine.comparePeriods(
      ctx.tenantId,
      assertMetricKey(input.metric),
      input.periodA,
      input.periodB,
      input.dimension,
      input.limit,
    );
  }

  async explainChange(
    ctx: RequestContext,
    input: {
      metric: string;
      period: MetricPeriod;
      comparePeriod?: MetricPeriod;
      dimensions?: DecompositionDimension[];
      topN?: number;
      currency?: string;
    },
  ) {
    assertTenantContext(ctx);
    return this.engine.explainChange(ctx.tenantId, input.metric, input.period, input.comparePeriod, {
      dimensions: input.dimensions,
      topN: input.topN,
      currency: input.currency,
    });
  }

  async getTrend(
    ctx: RequestContext,
    input: {
      metric: string;
      from: Date;
      to: Date;
      granularity?: 'day' | 'week' | 'month';
      anomalyThreshold?: number;
    },
  ) {
    assertTenantContext(ctx);
    return this.engine.getTrend(ctx.tenantId, assertMetricKey(input.metric), {
      from: input.from,
      to: input.to,
      granularity: input.granularity,
      anomalyThreshold: input.anomalyThreshold,
    });
  }

  async getForecast(
    ctx: RequestContext,
    input: { metric: string; horizonDays?: number; historyDays?: number },
  ) {
    assertTenantContext(ctx);
    return this.engine.getForecast(ctx.tenantId, assertMetricKey(input.metric), {
      horizonDays: input.horizonDays,
      historyDays: input.historyDays,
    });
  }

  async getCustomerProfile(ctx: RequestContext, customerId: string, period: MetricPeriod) {
    assertTenantContext(ctx);
    const profile = await this.engine.getCustomerProfile(ctx.tenantId, customerId, period);
    if (!profile) throw new AppError(ErrorCode.NOT_FOUND, 'Customer not found');
    return profile;
  }

  async getPipeline(
    ctx: RequestContext,
    options: { inactiveLeadDays?: number; hotLeadScore?: number; limit?: number } = {},
  ) {
    assertTenantContext(ctx);
    return this.engine.getPipeline(ctx.tenantId, options);
  }

  async getDataFreshness(ctx: RequestContext, staleHours?: number) {
    assertTenantContext(ctx);
    return this.engine.getDataFreshness(ctx.tenantId, staleHours);
  }

  async getPeriodProjection(ctx: RequestContext, period: MetricPeriod) {
    assertTenantContext(ctx);
    return this.engine.getPeriodProjection(ctx.tenantId, period);
  }

  async getProductPerformance(ctx: RequestContext, period: MetricPeriod, limit = 10) {
    assertTenantContext(ctx);
    return this.engine.getProductPerformance(ctx.tenantId, period, limit);
  }

  async getSalesHealth(ctx: RequestContext, period: MetricPeriod) {
    assertTenantContext(ctx);
    return this.engine.getSalesHealth(ctx.tenantId, period);
  }

  async getSellerPerformance(ctx: RequestContext, period: MetricPeriod, limit = 10) {
    assertTenantContext(ctx);
    return this.engine.getSellerPerformance(ctx.tenantId, period, limit);
  }

  async getCustomerVoice(ctx: RequestContext, period: MetricPeriod, limit = 10) {
    assertTenantContext(ctx);
    return this.engine.getCustomerVoice(ctx.tenantId, period, limit);
  }

  async getCustomerSegments(ctx: RequestContext, period: MetricPeriod, limit = 10) {
    assertTenantContext(ctx);
    return this.engine.getCustomerSegments(ctx.tenantId, period, limit);
  }

  async getProductAffinity(ctx: RequestContext, period: MetricPeriod, limit = 10) {
    assertTenantContext(ctx);
    return this.engine.getProductAffinity(ctx.tenantId, period, limit);
  }

  async getGoalsProgress(ctx: RequestContext) {
    assertTenantContext(ctx);
    return this.engine.getGoalsProgress(ctx.tenantId);
  }

  async getFunnel(ctx: RequestContext, period: MetricPeriod) {
    assertTenantContext(ctx);
    return this.engine.getFunnel(ctx.tenantId, period);
  }

  async getCohorts(ctx: RequestContext) {
    assertTenantContext(ctx);
    return this.engine.getCohorts(ctx.tenantId);
  }

  async getRfm(ctx: RequestContext) {
    assertTenantContext(ctx);
    return this.engine.getRfm(ctx.tenantId);
  }

  async simulate(
    ctx: RequestContext,
    scenario: { recoverCustomers?: number; discountShare?: number; goalId?: string },
    period: MetricPeriod,
  ) {
    assertTenantContext(ctx);
    return this.engine.simulate(ctx.tenantId, scenario, period);
  }

  async getProfitability(ctx: RequestContext, period: MetricPeriod) {
    assertTenantContext(ctx);
    return this.engine.getProfitability(ctx.tenantId, period);
  }

  async getCashFlow(ctx: RequestContext) {
    assertTenantContext(ctx);
    return this.engine.getCashFlow(ctx.tenantId);
  }

  async getInventoryRisk(ctx: RequestContext) {
    assertTenantContext(ctx);
    return this.engine.getInventoryRisk(ctx.tenantId);
  }

  async getAcquisition(ctx: RequestContext, period: MetricPeriod) {
    assertTenantContext(ctx);
    return this.engine.getAcquisition(ctx.tenantId, period);
  }
}
