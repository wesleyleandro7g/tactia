export { MetricEngine } from './metric-engine';
export { AnalyticsEngine, type SeriesProvider } from './analytics-engine';
export {
  summarizeTrend,
  detectAnomalies,
  movingAverage,
  linearSlope,
  mean,
  stdDev,
  zScore,
  bucketsBetween,
  bucketLabel,
  startOfBucket,
  addBuckets,
  type SeriesPoint,
  type TrendSummary,
  type TrendAnomaly,
  type Granularity,
} from './trend';
export {
  SnapshotEngine,
  SNAPSHOT_METRICS,
  SNAPSHOT_DIMENSIONS,
  isSnapshotMetric,
  startOfUtcDay,
  type SnapshotMetric,
  type SnapshotDimension,
  type SnapshotRow,
  type SnapshotRunOptions,
  type SnapshotRunResult,
  type MaterializeResult,
  type DailyPoint,
} from './snapshot-engine';
export {
  computeBaseline,
  weekdaySeasonality,
  rollingAggregates,
  fillDaily,
  countBusinessDays,
  describeBaseline,
  SnapshotBaselineProvider,
  NULL_BASELINE_PROVIDER,
  MIN_BASELINE_DAYS,
  REFERENCE_DAYS,
  HISTORY_DAYS,
  type BaselineStats,
  type BaselineOptions,
  type BaselineProvider,
  type BaselineQuery,
} from './baseline';
export {
  forecastDaily,
  forecastPeriodTotal,
  holtLinear,
  MIN_FORECAST_DAYS,
  type DailyForecast,
  type ForecastPoint,
  type ForecastMethod,
  type ForecastOptions,
  type PeriodForecast,
} from './forecast';
export { RuleEngine, type RuleEngineOptions, type RuleContext, type RuleInput } from './rule-engine';
export { InsightEngine, type InsightEngineOptions, type ProcessResult } from './insight-engine';
export { RecommendationEngine } from './recommendation-engine';
export {
  DEFAULT_RULES,
  RULE_KEYS_BY_RULE,
  ruleKeysOf,
  findChurnRiskCustomers,
  type Rule,
  type RuleFact,
  type ChurnRiskCustomer,
} from './rules';
export {
  decomposeChange,
  isDecomposable,
  DECOMPOSABLE_METRICS,
  type DecomposableMetric,
  type DecomposeInput,
} from './variance-decomposition';
export {
  computeScore,
  confidenceFromSample,
  eventFingerprint,
  isMaterial,
  MATERIALITY,
  SEVERITY_WEIGHT,
} from './scoring';
export { formatMoney, formatPercent, formatDelta, formatInteger } from './format';
export type {
  MetricResult,
  MetricInput,
  MetricPeriod,
  MetricKey,
  MetricDimension,
  DecompositionDimension,
  MetricBreakdownItem,
  PeriodGranularity,
  InsightTypeLiteral,
  InsightSeverityLiteral,
  DetectedEvent,
  Drivers,
  DimensionDrivers,
  DriverContributor,
  PriceVolumeMix,
  TenantThresholds,
} from './types';
export { METRIC_KEYS, METRIC_DEFINITIONS, DEFAULT_THRESHOLDS, THRESHOLD_KEYS } from './types';
