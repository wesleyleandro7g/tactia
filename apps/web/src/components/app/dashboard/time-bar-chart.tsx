'use client';

import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { ChartPoint } from '@/lib/chart';
import { formatCurrency, formatDayMonth, formatInteger } from '@/lib/format';
import { AccessibleChartTable } from '@/components/app/dashboard/accessible-chart-table';
import { ChartEmpty } from '@/components/app/dashboard/chart-empty';

export function TimeBarChart({
  title,
  description,
  points,
  format,
}: {
  title: string;
  description?: string;
  points: ChartPoint[];
  format: 'currency' | 'integer';
}) {
  const formatValue = (value: number) =>
    format === 'currency' ? formatCurrency(value) : formatInteger(value);

  if (points.length === 0) {
    return <ChartEmpty title={title} description={description} message="Sem vendas no período." />;
  }

  const total = points.reduce((sum, point) => sum + point.value, 0);
  const chartData = points.map((point) => ({ date: point.key, value: point.value }));
  const chartConfig = {
    value: { label: title, color: 'var(--chart-2)' },
  } satisfies ChartConfig;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const summary =
    points.length === 1
      ? `${title}: ${formatValue(first.value)} em ${formatDayMonth(first.key)}.`
      : `${title} de ${formatDayMonth(first.key)} a ${formatDayMonth(last.key)}. Total ${formatValue(total)}.`;

  return (
    <Card className="h-full min-w-0">
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        <p className="tabular text-sm font-medium text-foreground">{formatValue(total)}</p>
      </CardHeader>

      <ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full min-w-0 overflow-hidden" aria-label={summary}>
        <BarChart accessibilityLayer data={chartData} margin={{ top: 8, left: 4, right: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={(value) => formatDayMonth(String(value))}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                indicator="dashed"
                labelFormatter={(value) => formatDayMonth(String(value))}
                formatter={(value) => (
                  <div className="flex w-full items-center justify-between gap-4">
                    <span className="text-muted-foreground">{title}</span>
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {formatValue(Number(value))}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Bar dataKey="value" fill="var(--color-value)" radius={4} />
        </BarChart>
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
