import { z } from 'zod';

const themeSchema = z.enum(['light', 'dark']).optional();

const kpiItemSchema = z.object({
  label: z.string().trim().min(1).max(40),
  value: z.string().trim().min(1).max(32),
  delta: z.number().min(-10).max(10).optional(),
  hint: z.string().trim().max(48).optional(),
});

const comparisonSideSchema = z.object({
  label: z.string().trim().min(1).max(40),
  value: z.string().trim().min(1).max(32),
  numeric: z.number().optional(),
});

const rankingItemSchema = z.object({
  label: z.string().trim().min(1).max(48),
  value: z.string().trim().min(1).max(32),
  numeric: z.number().optional(),
  share: z.number().min(0).max(1).optional(),
});

const pieSliceSchema = z.object({
  label: z.string().trim().min(1).max(40),
  value: z.string().trim().min(1).max(32),
  numeric: z.number().nonnegative().optional(),
  share: z.number().min(0).max(1).optional(),
});

const linePointSchema = z.object({
  label: z.string().trim().min(1).max(16),
  value: z.string().trim().min(1).max(32),
  numeric: z.number(),
});

const periodMetricSchema = z.object({
  label: z.string().trim().min(1).max(40),
  left: z.string().trim().min(1).max(32),
  right: z.string().trim().min(1).max(32),
  leftNumeric: z.number().optional(),
  rightNumeric: z.number().optional(),
  delta: z.number().min(-10).max(10).optional(),
});

const barItemSchema = z.object({
  label: z.string().trim().min(1).max(28),
  value: z.string().trim().min(1).max(32),
  numeric: z.number().nonnegative(),
});

export const kpiSnapshotPayloadSchema = z.object({
  items: z.array(kpiItemSchema).min(1).max(4),
  footnote: z.string().trim().max(120).optional(),
});

export const comparisonPayloadSchema = z.object({
  metricLabel: z.string().trim().min(1).max(40),
  left: comparisonSideSchema,
  right: comparisonSideSchema,
  delta: z.number().min(-10).max(10).optional(),
  footnote: z.string().trim().max(120).optional(),
});

export const rankingPayloadSchema = z.object({
  metricLabel: z.string().trim().min(1).max(40).optional(),
  items: z.array(rankingItemSchema).min(1).max(8),
  footnote: z.string().trim().max(120).optional(),
});

export const insightCardPayloadSchema = z.object({
  highlight: z.string().trim().min(1).max(48),
  highlightLabel: z.string().trim().min(1).max(40).optional(),
  bullets: z.array(z.string().trim().min(1).max(120)).min(1).max(4),
  footnote: z.string().trim().max(120).optional(),
});

export const pieChartPayloadSchema = z.object({
  items: z.array(pieSliceSchema).min(2).max(6),
  centerLabel: z.string().trim().max(24).optional(),
  centerValue: z.string().trim().max(24).optional(),
  footnote: z.string().trim().max(120).optional(),
});

export const lineChartPayloadSchema = z.object({
  metricLabel: z.string().trim().min(1).max(40).optional(),
  points: z.array(linePointSchema).min(3).max(12),
  delta: z.number().min(-10).max(10).optional(),
  footnote: z.string().trim().max(120).optional(),
});

export const periodComparisonPayloadSchema = z.object({
  leftLabel: z.string().trim().min(1).max(32),
  rightLabel: z.string().trim().min(1).max(32),
  metrics: z.array(periodMetricSchema).min(2).max(6),
  footnote: z.string().trim().max(120).optional(),
});

export const barChartPayloadSchema = z.object({
  metricLabel: z.string().trim().min(1).max(40).optional(),
  items: z.array(barItemSchema).min(2).max(8),
  footnote: z.string().trim().max(120).optional(),
});

export const infographicSpecSchema = z.discriminatedUnion('template', [
  z.object({
    template: z.literal('kpi_snapshot'),
    title: z.string().trim().min(1).max(80),
    subtitle: z.string().trim().max(120).optional(),
    theme: themeSchema,
    payload: kpiSnapshotPayloadSchema,
  }),
  z.object({
    template: z.literal('comparison'),
    title: z.string().trim().min(1).max(80),
    subtitle: z.string().trim().max(120).optional(),
    theme: themeSchema,
    payload: comparisonPayloadSchema,
  }),
  z.object({
    template: z.literal('ranking'),
    title: z.string().trim().min(1).max(80),
    subtitle: z.string().trim().max(120).optional(),
    theme: themeSchema,
    payload: rankingPayloadSchema,
  }),
  z.object({
    template: z.literal('insight_card'),
    title: z.string().trim().min(1).max(80),
    subtitle: z.string().trim().max(120).optional(),
    theme: themeSchema,
    payload: insightCardPayloadSchema,
  }),
  z.object({
    template: z.literal('pie_chart'),
    title: z.string().trim().min(1).max(80),
    subtitle: z.string().trim().max(120).optional(),
    theme: themeSchema,
    payload: pieChartPayloadSchema,
  }),
  z.object({
    template: z.literal('line_chart'),
    title: z.string().trim().min(1).max(80),
    subtitle: z.string().trim().max(120).optional(),
    theme: themeSchema,
    payload: lineChartPayloadSchema,
  }),
  z.object({
    template: z.literal('period_comparison'),
    title: z.string().trim().min(1).max(80),
    subtitle: z.string().trim().max(120).optional(),
    theme: themeSchema,
    payload: periodComparisonPayloadSchema,
  }),
  z.object({
    template: z.literal('bar_chart'),
    title: z.string().trim().min(1).max(80),
    subtitle: z.string().trim().max(120).optional(),
    theme: themeSchema,
    payload: barChartPayloadSchema,
  }),
]);

export type InfographicSpec = z.infer<typeof infographicSpecSchema>;
export type InfographicTemplate = InfographicSpec['template'];

export const INFOGRAPHIC_TEMPLATE_IDS = [
  'kpi_snapshot',
  'comparison',
  'ranking',
  'insight_card',
  'pie_chart',
  'line_chart',
  'period_comparison',
  'bar_chart',
] as const satisfies readonly InfographicTemplate[];
