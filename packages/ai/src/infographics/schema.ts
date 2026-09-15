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
]);

export type InfographicSpec = z.infer<typeof infographicSpecSchema>;
export type InfographicTemplate = InfographicSpec['template'];
