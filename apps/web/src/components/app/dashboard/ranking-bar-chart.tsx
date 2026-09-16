'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { NamedChartItem } from '@/lib/chart';
import { formatCurrency, formatInteger } from '@/lib/format';
import { AccessibleChartTable } from '@/components/app/dashboard/accessible-chart-table';
import { ChartEmpty } from '@/components/app/dashboard/chart-empty';

function shorten(label: string, max = 18) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export function RankingBarChart({
  title,
  description,
  items,
  format,
  layout = 'horizontal',
  color = 'var(--chart-3)',
}: {
  title: string;
  description?: string;
  items: NamedChartItem[];
  format: 'currency' | 'integer';
  layout?: 'horizontal' | 'vertical';
  color?: string;
}) {
  const formatValue = (value: number) =>
    format === 'currency' ? formatCurrency(value) : formatInteger(value);

  if (items.length === 0) {
    return <ChartEmpty title={title} description={description} />;
  }

  const chartData = items.map((item) => ({ name: item.label, value: item.value }));
  const chartConfig = {
    value: { label: title, color },
  } satisfies ChartConfig;
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const summary = `${title}. ${items
    .slice(0, 5)
    .map((item) => `${item.label}: ${formatValue(item.value)}`)
    .join('; ')}.`;

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
        {layout === 'horizontal' ? (
          <BarChart
            accessibilityLayer
            data={chartData}
            layout="vertical"
            margin={{ top: 0, left: 0, right: 8, bottom: 0 }}
          >
            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
            <XAxis type="number" hide />
            <YAxis
              dataKey="name"
              type="category"
              tickLine={false}
              axisLine={false}
              width={72}
              interval={0}
              tickFormatter={(value) => shorten(String(value), 12)}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
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
        ) : (
          <BarChart accessibilityLayer data={chartData} margin={{ top: 8, left: 4, right: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => shorten(String(value), 10)}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
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
        )}
      </ChartContainer>

      <AccessibleChartTable
        caption={summary}
        labelHeader="Item"
        valueHeader={title}
        rows={items.map((item) => ({
          key: item.key,
          label: item.label,
          value: formatValue(item.value),
        }))}
      />
    </Card>
  );
}
