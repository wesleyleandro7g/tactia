'use client';

import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { ChartPoint } from '@/lib/chart';
import { formatCurrency, formatDayMonth, formatInteger } from '@/lib/format';

export type TrendChartProps = {
  title: string;
  description?: string;
  points: ChartPoint[];
  format: 'currency' | 'integer';
};

/**
 * Série temporal com shadcn ChartContainer + Recharts AreaChart.
 *
 * O dado nunca fica só no desenho: há `aria-label` com o resumo e uma tabela
 * `sr-only` com todos os pontos, então leitor de tela e ctrl+F alcançam tudo.
 */
export function TrendChart({ title, description, points, format }: TrendChartProps) {
  const gradientId = useId().replace(/:/g, '');
  const formatValue = (value: number) =>
    format === 'currency' ? formatCurrency(value) : formatInteger(value);

  const values = points.map((point) => point.value);
  const total = values.reduce((sum, value) => sum + value, 0);
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;
  const chartData = points.map((point) => ({
    date: point.key,
    value: point.value,
  }));

  const chartConfig = {
    value: {
      label: title,
      color: 'var(--chart-1)',
    },
  } satisfies ChartConfig;

  if (points.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
        </CardHeader>
        <p className="py-10 text-center text-sm text-muted-foreground">Sem vendas no período.</p>
      </Card>
    );
  }

  const summary =
    points.length === 1
      ? `${title}: ${formatValue(points[0]!.value)} em ${formatDayMonth(points[0]!.key)}.`
      : `${title} de ${formatDayMonth(points[0]!.key)} a ${formatDayMonth(points[points.length - 1]!.key)}. ` +
        `Total ${formatValue(total)}, mínimo ${formatValue(min)}, máximo ${formatValue(max)}.`;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        <p className="tabular text-sm font-medium text-foreground">{formatValue(total)}</p>
      </CardHeader>

      {points.length === 1 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Apenas um dia com dados — sem tendência para exibir.
        </p>
      ) : (
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[180px] w-full"
          aria-label={summary}
        >
          <AreaChart
            accessibilityLayer
            data={chartData}
            margin={{ top: 8, left: 4, right: 4, bottom: 0 }}
          >
            <defs>
              <linearGradient id={`fill-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.35} />
                <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0.05} />
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
            <Area
              dataKey="value"
              type="monotone"
              fill={`url(#fill-${gradientId})`}
              stroke="var(--color-value)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
            />
          </AreaChart>
        </ChartContainer>
      )}

      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{formatDayMonth(points[0]!.key)}</span>
        <span>{formatDayMonth(points[points.length - 1]!.key)}</span>
      </div>

      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">{title}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.key}>
              <td>{formatDayMonth(point.key)}</td>
              <td>{formatValue(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
