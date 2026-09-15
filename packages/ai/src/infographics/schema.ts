import { z } from 'zod';

const themeSchema = z.enum(['light', 'dark']).optional();

/** Display labels/values — LLMs often send bare numbers; coerce to string. */
const displayString = (max: number) =>
  z.preprocess(
    (val) => (typeof val === 'number' && Number.isFinite(val) ? String(val) : val),
    z.string().trim().min(1).max(max),
  );

const optionalDisplayString = (max: number) =>
  z.preprocess(
    (val) => {
      if (val === undefined || val === null || val === '') return undefined;
      if (typeof val === 'number' && Number.isFinite(val)) return String(val);
      return val;
    },
    z.string().trim().max(max).optional(),
  );

const kpiItemSchema = z.object({
  label: displayString(40),
  value: displayString(32),
  delta: z.number().min(-10).max(10).optional(),
  hint: optionalDisplayString(48),
});

const comparisonSideSchema = z.object({
  label: displayString(40),
  value: displayString(32),
  numeric: z.number().optional(),
});

const rankingItemSchema = z.object({
  label: displayString(48),
  value: displayString(32),
  numeric: z.number().optional(),
  share: z.number().min(0).max(1).optional(),
});

const pieSliceSchema = z.object({
  label: displayString(40),
  value: displayString(32),
  numeric: z.number().nonnegative().optional(),
  share: z.number().min(0).max(1).optional(),
});

const linePointSchema = z.object({
  label: displayString(16),
  value: displayString(32),
  numeric: z.number(),
});

const periodMetricSchema = z.object({
  label: displayString(40),
  left: displayString(32),
  right: displayString(32),
  leftNumeric: z.number().optional(),
  rightNumeric: z.number().optional(),
  delta: z.number().min(-10).max(10).optional(),
});

const barItemSchema = z.object({
  label: displayString(28),
  value: displayString(32),
  numeric: z.number().nonnegative(),
});

/** Keep layout bounds: LLMs often send full lists; take the first N. */
function cappedArray<T extends z.ZodTypeAny>(item: T, min: number, max: number) {
  return z
    .array(item)
    .min(min)
    .transform((items) => (items.length > max ? items.slice(0, max) : items));
}

export const kpiSnapshotPayloadSchema = z.object({
  items: cappedArray(kpiItemSchema, 1, 4),
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
  items: cappedArray(rankingItemSchema, 1, 8),
  footnote: z.string().trim().max(120).optional(),
});

export const insightCardPayloadSchema = z.object({
  highlight: displayString(48),
  highlightLabel: optionalDisplayString(40),
  bullets: cappedArray(z.string().trim().min(1).max(120), 1, 4),
  footnote: optionalDisplayString(120),
});

export const pieChartPayloadSchema = z.object({
  items: cappedArray(pieSliceSchema, 2, 6),
  centerLabel: optionalDisplayString(24),
  centerValue: optionalDisplayString(24),
  footnote: optionalDisplayString(120),
});

export const lineChartPayloadSchema = z.object({
  metricLabel: z.string().trim().min(1).max(40).optional(),
  points: cappedArray(linePointSchema, 3, 12),
  delta: z.number().min(-10).max(10).optional(),
  footnote: z.string().trim().max(120).optional(),
});

export const periodComparisonPayloadSchema = z.object({
  leftLabel: z.string().trim().min(1).max(32),
  rightLabel: z.string().trim().min(1).max(32),
  metrics: cappedArray(periodMetricSchema, 2, 6),
  footnote: z.string().trim().max(120).optional(),
});

export const barChartPayloadSchema = z.object({
  metricLabel: z.string().trim().min(1).max(40).optional(),
  items: cappedArray(barItemSchema, 2, 8),
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

/**
 * LLM tool input — must be a top-level Zod object.
 * OpenAI rejects discriminatedUnion (JSON Schema `anyOf` without `type: "object"`).
 * Strict shape is re-validated with `infographicSpecSchema` after the call.
 */
export const generateInfographicToolInputSchema = z.object({
  template: z
    .enum(INFOGRAPHIC_TEMPLATE_IDS)
    .describe(
      'Template: kpi_snapshot | comparison | ranking | insight_card | pie_chart | line_chart | period_comparison | bar_chart',
    ),
  title: z.string().trim().min(1).max(80),
  subtitle: z.string().trim().max(120).optional(),
  theme: themeSchema,
  payload: z
    .record(z.unknown())
    .describe(
      'Dados do template. kpi_snapshot: {items[{label,value,delta?,hint?}],footnote?}. ' +
        'comparison: {metricLabel,left{label,value,numeric?},right{...},delta?,footnote?}. ' +
        'ranking: {metricLabel?,items[{label,value,numeric?,share?}],footnote?}. ' +
        'insight_card: {highlight,highlightLabel?,bullets[],footnote?}. ' +
        'pie_chart: {items[{label,value,numeric?,share?}],centerLabel?,centerValue?,footnote?}. ' +
        'line_chart: {metricLabel?,points[{label,value,numeric}],delta?,footnote?}. ' +
        'period_comparison: {leftLabel,rightLabel,metrics[{label,left,right,leftNumeric?,rightNumeric?,delta?}],footnote?}. ' +
        'bar_chart: {metricLabel?,items[{label,value,numeric}],footnote?}.',
    ),
});

export type GenerateInfographicToolInput = z.infer<typeof generateInfographicToolInputSchema>;
