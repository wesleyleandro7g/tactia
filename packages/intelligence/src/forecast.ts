import { weekdaySeasonality } from './baseline';
import type { DailyPoint } from './snapshot-engine';
import { mean, stdDev } from './trend';

/**
 * Deterministic daily forecast (Etapa 11 — B3): weekday seasonality × Holt
 * linear (double exponential smoothing) with a P10/P90 band from one-step
 * residuals. Pure functions — the engine feeds daily snapshots in.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** z for the 10th/90th percentiles of a normal distribution. */
const Z_P90 = 1.2816;
/** Minimum history to prefer Holt over a plain daily average. */
export const MIN_FORECAST_DAYS = 14;

export type ForecastPoint = {
  date: string;
  expected: number;
  low: number;
  high: number;
};

export type ForecastMethod = 'seasonal_holt' | 'seasonal_mean' | 'linear';

export type DailyForecast = {
  method: ForecastMethod;
  points: ForecastPoint[];
  total: { expected: number; low: number; high: number };
  /** Fitted level/trend at the end of history (deseasonalized units per day). */
  level: number;
  trend: number;
  /** Std-dev of one-step-ahead residuals (deseasonalized). */
  sigma: number;
  weekdayIndex: number[];
  historyDays: number;
  /** 0..1 — grows with history length and shrinks with relative noise. */
  confidence: number;
};

export type ForecastOptions = {
  alpha?: number;
  beta?: number;
  /** Clamp forecasts at zero (counts, revenue). Default true. */
  nonNegative?: boolean;
  /** Average daily values instead of summing for `total` (rates). Default false. */
  aggregate?: 'sum' | 'mean';
};

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Holt's linear method. Returns the final level/trend and the one-step
 * residuals used for the uncertainty band.
 */
export function holtLinear(
  values: number[],
  alpha = 0.3,
  beta = 0.1,
): { level: number; trend: number; residuals: number[] } {
  if (values.length === 0) return { level: 0, trend: 0, residuals: [] };
  if (values.length === 1) return { level: values[0]!, trend: 0, residuals: [] };

  let level = values[0]!;
  let trend = values[1]! - values[0]!;
  const residuals: number[] = [];

  for (let t = 1; t < values.length; t++) {
    const forecast = level + trend;
    residuals.push(values[t]! - forecast);
    const newLevel = alpha * values[t]! + (1 - alpha) * (level + trend);
    trend = beta * (newLevel - level) + (1 - beta) * trend;
    level = newLevel;
  }
  return { level, trend, residuals };
}

/**
 * Forecast `horizonDays` daily values starting at `start` (UTC day) from a
 * zero-filled daily history ending the day before `start`.
 */
export function forecastDaily(
  history: DailyPoint[],
  start: Date,
  horizonDays: number,
  options: ForecastOptions = {},
): DailyForecast {
  const nonNegative = options.nonNegative ?? true;
  const aggregate = options.aggregate ?? 'sum';
  const sorted = [...history].sort((a, b) => a.date.getTime() - b.date.getTime());
  const values = sorted.map((p) => p.value);
  const startDay = startOfUtcDay(start);

  const weekdayIndex = weekdaySeasonality(sorted);
  const deseasonalized = sorted.map((p) => p.value / (weekdayIndex[p.date.getUTCDay()] || 1));

  let method: ForecastMethod;
  let level: number;
  let trend: number;
  let sigma: number;

  if (sorted.length >= MIN_FORECAST_DAYS) {
    const fit = holtLinear(deseasonalized, options.alpha, options.beta);
    // Recent residuals matter more than ancient ones for the band.
    const recent = fit.residuals.slice(-28);
    level = fit.level;
    trend = fit.trend;
    sigma = stdDev(recent);
    method = 'seasonal_holt';
    // Guard against runaway trends on short/noisy histories: cap the daily
    // trend at 5% of the level.
    const cap = Math.abs(level) * 0.05;
    if (Math.abs(trend) > cap) trend = Math.sign(trend) * cap;
  } else if (sorted.length > 0) {
    level = mean(deseasonalized);
    trend = 0;
    sigma = stdDev(deseasonalized);
    method = sorted.length >= 7 ? 'seasonal_mean' : 'linear';
  } else {
    level = 0;
    trend = 0;
    sigma = 0;
    method = 'linear';
  }

  const points: ForecastPoint[] = [];
  let sumExpected = 0;
  let sumLow = 0;
  let sumHigh = 0;

  for (let h = 1; h <= horizonDays; h++) {
    const date = new Date(startDay.getTime() + (h - 1) * DAY_MS);
    const season = weekdayIndex[date.getUTCDay()] ?? 1;
    const base = (level + trend * h) * season;
    // Uncertainty widens with the horizon (random-walk-like growth).
    const spread = Z_P90 * sigma * Math.sqrt(h) * season;
    let expected = base;
    let low = base - spread;
    let high = base + spread;
    if (nonNegative) {
      expected = Math.max(0, expected);
      low = Math.max(0, low);
      high = Math.max(0, high);
    }
    points.push({
      date: date.toISOString().slice(0, 10),
      expected: round4(expected),
      low: round4(low),
      high: round4(high),
    });
    sumExpected += expected;
    sumLow += low;
    sumHigh += high;
  }

  const divisor = aggregate === 'mean' && horizonDays > 0 ? horizonDays : 1;
  const avg = mean(values);
  const noise = avg > 0 ? sigma / avg : 1;
  const confidence = Math.max(
    0.1,
    Math.min(0.95, (1 - Math.exp(-sorted.length / 28)) * (1 - Math.min(0.8, noise * 0.5))),
  );

  return {
    method,
    points,
    total: {
      expected: round4(sumExpected / divisor),
      low: round4(sumLow / divisor),
      high: round4(sumHigh / divisor),
    },
    level: round4(level),
    trend: round4(trend),
    sigma: round4(sigma),
    weekdayIndex: weekdayIndex.map((v) => Math.round(v * 1000) / 1000),
    historyDays: sorted.length,
    confidence: Math.round(confidence * 100) / 100,
  };
}

export type PeriodForecast = {
  /** Value observed so far in the period (live). */
  actual: number;
  /** Forecast for the remaining part of the period. */
  remaining: { expected: number; low: number; high: number };
  /** actual + remaining. */
  projected: { expected: number; low: number; high: number };
  remainingDays: number;
  method: ForecastMethod;
  confidence: number;
  historyDays: number;
};

/**
 * Project the end-of-period total: what was already observed plus a forecast
 * for the days still to come (today's remaining fraction included).
 */
export function forecastPeriodTotal(input: {
  history: DailyPoint[];
  actualToDate: number;
  period: { from: Date; to: Date };
  now: Date;
  options?: ForecastOptions;
}): PeriodForecast {
  const now = input.now;
  const end = input.period.to;
  if (now >= end) {
    return {
      actual: input.actualToDate,
      remaining: { expected: 0, low: 0, high: 0 },
      projected: { expected: input.actualToDate, low: input.actualToDate, high: input.actualToDate },
      remainingDays: 0,
      method: 'linear',
      confidence: 1,
      historyDays: input.history.length,
    };
  }

  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const todayRemainingFraction = Math.max(0, Math.min(1, (tomorrow.getTime() - now.getTime()) / DAY_MS));
  const fullDaysLeft = Math.max(0, Math.round((startOfUtcDay(end).getTime() - tomorrow.getTime()) / DAY_MS));
  const horizon = fullDaysLeft + 1; // today (partial) + full days

  const forecast = forecastDaily(input.history, today, horizon, input.options);
  const [todayPoint, ...rest] = forecast.points;

  const remainingExpected =
    (todayPoint?.expected ?? 0) * todayRemainingFraction + rest.reduce((s, p) => s + p.expected, 0);
  const remainingLow =
    (todayPoint?.low ?? 0) * todayRemainingFraction + rest.reduce((s, p) => s + p.low, 0);
  const remainingHigh =
    (todayPoint?.high ?? 0) * todayRemainingFraction + rest.reduce((s, p) => s + p.high, 0);

  return {
    actual: input.actualToDate,
    remaining: {
      expected: round4(remainingExpected),
      low: round4(remainingLow),
      high: round4(remainingHigh),
    },
    projected: {
      expected: round4(input.actualToDate + remainingExpected),
      low: round4(input.actualToDate + remainingLow),
      high: round4(input.actualToDate + remainingHigh),
    },
    remainingDays: round4(fullDaysLeft + todayRemainingFraction),
    method: forecast.method,
    confidence: forecast.confidence,
    historyDays: forecast.historyDays,
  };
}
