import { describe, expect, it } from 'vitest';
import {
  computeBaseline,
  countBusinessDays,
  fillDaily,
  rollingAggregates,
  weekdaySeasonality,
} from '../baseline';
import type { DailyPoint } from '../snapshot-engine';

const DAY = 24 * 60 * 60 * 1000;

function day(offset: number, base = Date.UTC(2026, 0, 5)): Date {
  // 2026-01-05 is a Monday
  return new Date(base + offset * DAY);
}

/** 12 weeks of history: weekdays sell 1000, weekends 200. */
function history(days = 84): DailyPoint[] {
  return Array.from({ length: days }, (_, i) => {
    const date = day(i - days);
    const wd = date.getUTCDay();
    return { date, value: wd === 0 || wd === 6 ? 200 : 1000 };
  });
}

describe('weekdaySeasonality', () => {
  it('returns 1s without enough data', () => {
    expect(weekdaySeasonality(history(7))).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it('gives weekends a lower index than weekdays', () => {
    const index = weekdaySeasonality(history());
    expect(index[0]).toBeLessThan(0.5);
    expect(index[6]).toBeLessThan(0.5);
    expect(index[1]).toBeGreaterThan(1);
    // Indices average to ~1 over a full week.
    const avg = index.reduce((s, v) => s + v, 0) / 7;
    expect(avg).toBeCloseTo(1, 1);
  });
});

describe('rollingAggregates', () => {
  it('computes rolling sums and means', () => {
    const pts = [1, 2, 3, 4, 5].map((v, i) => ({ date: day(i), value: v }));
    expect(rollingAggregates(pts, 2)).toEqual([3, 5, 7, 9]);
    expect(rollingAggregates(pts, 2, 'mean')).toEqual([1.5, 2.5, 3.5, 4.5]);
    expect(rollingAggregates(pts, 10)).toEqual([]);
  });
});

describe('fillDaily / countBusinessDays', () => {
  it('zero-fills gaps', () => {
    const filled = fillDaily([{ date: day(1), value: 5 }], day(0), day(3));
    expect(filled.map((p) => p.value)).toEqual([0, 5, 0]);
  });

  it('counts Mon-Fri', () => {
    expect(countBusinessDays({ from: day(0), to: day(7) })).toBe(5);
  });
});

describe('computeBaseline', () => {
  it('returns null with short history', () => {
    expect(
      computeBaseline({
        metric: 'revenue',
        period: { from: day(0), to: day(7) },
        history: history(10),
        periodDaily: [],
      }),
    ).toBeNull();
  });

  it('treats a normal week as normal and cites the 4-week reference', () => {
    const period = { from: day(0), to: day(7) };
    const stats = computeBaseline({
      metric: 'revenue',
      period,
      history: history(),
      periodDaily: fillDaily(history().map((p) => ({ ...p, date: new Date(p.date.getTime() + 84 * DAY) })), day(0), day(7)),
    });
    expect(stats).not.toBeNull();
    expect(stats!.current).toBe(5400);
    expect(stats!.expected).toBeCloseTo(5400, 0);
    expect(stats!.isAnomaly).toBe(false);
    expect(stats!.direction).toBe('normal');
    expect(stats!.referenceLabel).toBe('média das últimas 4 semanas');
    expect(stats!.businessDays.period).toBe(5);
    expect(stats!.movingAvg28).toBeCloseTo(5400 / 7, 3);
  });

  it('flags a collapsed week as anomaly below baseline', () => {
    // Inject variance into the history so the z-score is finite.
    const noisy = history().map((p, i) => ({ ...p, value: p.value + (i % 3) * 50 }));
    const period = { from: day(0), to: day(7) };
    const stats = computeBaseline({
      metric: 'revenue',
      period,
      history: noisy,
      periodDaily: fillDaily([{ date: day(0), value: 800 }], day(0), day(7)),
    });
    expect(stats).not.toBeNull();
    expect(stats!.current).toBe(800);
    expect(stats!.zScore).not.toBeNull();
    expect(stats!.zScore!).toBeLessThan(-2);
    expect(stats!.isAnomaly).toBe(true);
    expect(stats!.direction).toBe('below');
    expect(stats!.deviation).toBeLessThan(-0.8);
  });

  it('computes YoY when provided', () => {
    const period = { from: day(0), to: day(7) };
    const stats = computeBaseline({
      metric: 'revenue',
      period,
      history: history(),
      periodDaily: fillDaily([{ date: day(0), value: 6000 }], day(0), day(7)),
      options: { yoyDaily: [{ date: day(-365), value: 3000 }] },
    });
    expect(stats!.yoy).toEqual({ value: 3000, change: 1 });
  });

  it('averages rate metrics instead of summing', () => {
    const period = { from: day(0), to: day(7) };
    const rates = history().map((p) => ({ ...p, value: 0.4 }));
    const stats = computeBaseline({
      metric: 'gross_margin',
      period,
      history: rates,
      periodDaily: fillDaily(
        Array.from({ length: 7 }, (_, i) => ({ date: day(i), value: 0.3 })),
        day(0),
        day(7),
      ),
      options: { aggregate: 'mean' },
    });
    expect(stats!.current).toBeCloseTo(0.3, 4);
    expect(stats!.expected).toBeCloseTo(0.4, 4);
  });
});
