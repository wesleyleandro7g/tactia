import { describe, expect, it } from 'vitest';
import { forecastDaily, forecastPeriodTotal, holtLinear } from '../forecast';
import type { DailyPoint } from '../snapshot-engine';

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 0, 5); // Monday

function day(offset: number): Date {
  return new Date(BASE + offset * DAY);
}

function seasonalHistory(days = 56, weekday = 1000, weekend = 200, growthPerDay = 0): DailyPoint[] {
  return Array.from({ length: days }, (_, i) => {
    const date = day(i - days);
    const wd = date.getUTCDay();
    const base = wd === 0 || wd === 6 ? weekend : weekday;
    return { date, value: base + growthPerDay * i };
  });
}

describe('holtLinear', () => {
  it('follows a linear trend', () => {
    const values = Array.from({ length: 30 }, (_, i) => 100 + 5 * i);
    const fit = holtLinear(values, 0.5, 0.3);
    expect(fit.level).toBeCloseTo(100 + 5 * 29, -1);
    expect(fit.trend).toBeCloseTo(5, 0);
  });

  it('handles tiny inputs', () => {
    expect(holtLinear([])).toEqual({ level: 0, trend: 0, residuals: [] });
    expect(holtLinear([7])).toEqual({ level: 7, trend: 0, residuals: [] });
  });
});

describe('forecastDaily', () => {
  it('reproduces weekday seasonality with a stable history', () => {
    const forecast = forecastDaily(seasonalHistory(), day(0), 7);
    expect(forecast.method).toBe('seasonal_holt');
    expect(forecast.points).toHaveLength(7);
    // Monday..Friday high, Saturday/Sunday low
    expect(forecast.points[0]!.expected).toBeGreaterThan(800);
    expect(forecast.points[5]!.expected).toBeLessThan(400);
    expect(forecast.total.expected).toBeCloseTo(5400, -2);
    // Band is ordered and (nearly) collapsed with no noise.
    for (const p of forecast.points) {
      expect(p.low).toBeLessThanOrEqual(p.expected);
      expect(p.high).toBeGreaterThanOrEqual(p.expected);
    }
  });

  it('projects growth when history trends up', () => {
    const flat = forecastDaily(seasonalHistory(56, 1000, 200, 0), day(0), 14);
    const growing = forecastDaily(seasonalHistory(56, 1000, 200, 10), day(0), 14);
    expect(growing.total.expected).toBeGreaterThan(flat.total.expected);
    expect(growing.trend).toBeGreaterThan(0);
  });

  it('falls back to mean/linear with short history and never goes negative', () => {
    const short = forecastDaily(seasonalHistory(5), day(0), 3);
    expect(short.method).toBe('linear');
    const none = forecastDaily([], day(0), 3);
    expect(none.total.expected).toBe(0);
    for (const p of none.points) expect(p.low).toBeGreaterThanOrEqual(0);
  });

  it('averages rate metrics for the total', () => {
    const rates = seasonalHistory(28).map((p) => ({ ...p, value: 0.4 }));
    const forecast = forecastDaily(rates, day(0), 10, { aggregate: 'mean' });
    expect(forecast.total.expected).toBeCloseTo(0.4, 2);
  });
});

describe('forecastPeriodTotal', () => {
  it('adds the remaining forecast to the actual', () => {
    const period = { from: day(0), to: day(7) };
    const now = new Date(day(2).getTime() + 12 * 60 * 60 * 1000); // Wed noon
    const result = forecastPeriodTotal({
      history: seasonalHistory(),
      actualToDate: 2500,
      period,
      now,
    });
    expect(result.actual).toBe(2500);
    expect(result.remainingDays).toBeCloseTo(4.5, 1);
    // ~half of Wednesday (500) + Thu + Fri (2000) + Sat + Sun (400) ≈ 2900
    expect(result.remaining.expected).toBeGreaterThan(2500);
    expect(result.remaining.expected).toBeLessThan(3300);
    expect(result.projected.expected).toBeCloseTo(2500 + result.remaining.expected, 4);
    expect(result.projected.low).toBeLessThanOrEqual(result.projected.expected);
    expect(result.projected.high).toBeGreaterThanOrEqual(result.projected.expected);
  });

  it('returns the actual when the period is over', () => {
    const result = forecastPeriodTotal({
      history: seasonalHistory(),
      actualToDate: 999,
      period: { from: day(-7), to: day(0) },
      now: day(1),
    });
    expect(result.projected).toEqual({ expected: 999, low: 999, high: 999 });
    expect(result.remainingDays).toBe(0);
  });
});
