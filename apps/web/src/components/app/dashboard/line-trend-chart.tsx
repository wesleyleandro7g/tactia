'use client';

import { useId } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, XAxis } from 'recharts';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { ChartPoint } from '@/lib/chart';
import { overlayTimeSeries } from '@/lib/chart';
import { formatCurrency, formatDayMonth, formatInteger } from '@/lib/format';
import { AccessibleChartTable } from '@/components/app/dashboard/accessible-chart-table';
import { ChartEmpty } from '@/components/app/dashboard/chart-empty';

export function LineTrendChart({
  title,
  description,
  points,
  previousPoints = [],
  previousShiftMs,
  format,
}: {
  title: string;
  description?: string;
  points: ChartPoint[];
  previousPoints?: ChartPoint[];
  previousShiftMs?: number;
  format: 'currency' | 'integer';
}) {
  const gradientId = useId().replace(/:/g, '');
  const formatValue = (value: number) =>
    format === 'currency' ? formatCurrency(value) : formatInteger(value);

  if (points.length === 0) {
    return <ChartEmpty title={title} description={description} message="Sem vendas no período." />;
  }

  if (points.length === 1) {
    return (
      <ChartEmpty
        title={title}
        description={description}
        message="Apenas um dia com dados — sem tendência para exibir."
      />
    );
  }

  const inferredShift =
    previousPoints[0] && points[0]
      ? new Date(points[0].key).getTime() - new Date(previousPoints[0].key).getTime()
      : 0;
  const shiftMs = previousShiftMs ?? inferredShift;
  const overlay = overlayTimeSeries(points, previousPoints, Number.isFinite(shiftMs) ? shiftMs : 0);
  const hasPrevious = overlay.some((point) => point.previous != null);
  const chartData = overlay.map((point) => ({
    date: point.key,
    current: point.current,
    previous: point.previous,
  }));

  const total = points.reduce((sum, point) => sum + point.value, 0);
  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));
  const summary =
    `${title} de ${formatDayMonth(points[0]!.key)} a ${formatDayMonth(points[points.length - 1]!.key)}. ` +
    `Total ${formatValue(total)}, mínimo ${formatValue(min)}, máximo ${formatValue(max)}.`;

  const chartConfig = {
    current: { label: 'Período atual', color: 'var(--chart-1)' },
    previous: { label: 'Período anterior', color: 'var(--chart-4)' },
  } satisfies ChartConfig;

  return (
    <Card className="h-full min-w-0">
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        <p className="tabular text-sm font-medium text-foreground">{formatValue(total)}</p>
      </CardHeader>

      <ChartContainer config={chartConfig} className="aspect-auto h-[240px] w-full min-w-0 overflow-hidden" aria-label={summary}>
        <ComposedChart data={chartData} margin={{ top: 8, left: 4, right: 8, bottom: 0 }}>
          <defs>
            <linearGradient id={`fill-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-current)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--color-current)" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={(value) => formatDayMonth(String(value))}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                indicator="line"
                labelFormatter={(value) => formatDayMonth(String(value))}
                formatter={(value, name) => (
                  <div className="flex w-full items-center justify-between gap-4">
                    <span className="text-muted-foreground">
                      {name === 'previous' ? 'Período anterior' : 'Período atual'}
                    </span>
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {formatValue(Number(value))}
                    </span>
                  </div>
                )}
              />
            }
          />
          {hasPrevious ? <ChartLegend content={<ChartLegendContent />} /> : null}
          <Area
            dataKey="current"
            type="monotone"
            fill={`url(#fill-${gradientId})`}
            stroke="var(--color-current)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
          />
          {hasPrevious ? (
            <Line
              dataKey="previous"
              type="monotone"
              stroke="var(--color-previous)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              connectNulls={false}
            />
          ) : null}
        </ComposedChart>
      </ChartContainer>

      <AccessibleChartTable
        caption={summary}
        labelHeader="Data"
        valueHeader={title}
        rows={points.map((point) => ({
          key: point.key,
          label: formatDayMonth(point.key),
          value: formatValue(point.value),
        }))}
      />
    </Card>
  );
}
