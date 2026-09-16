'use client';

import { Label, Pie, PieChart } from 'recharts';

import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { NamedChartItem } from '@/lib/chart';
import { formatCurrency } from '@/lib/format';
import { AccessibleChartTable } from '@/components/app/dashboard/accessible-chart-table';
import { ChartEmpty } from '@/components/app/dashboard/chart-empty';

const SLICE_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

export function CategoryDonutChart({
  title,
  description,
  items,
}: {
  title: string;
  description?: string;
  items: NamedChartItem[];
}) {
  if (items.length === 0) {
    return <ChartEmpty title={title} description={description} />;
  }

  const chartData = items.map((item, index) => ({
    slice: `slice-${index}`,
    label: item.label,
    value: item.value,
    fill: `var(--color-slice-${index})`,
  }));

  const chartConfig = {
    value: { label: 'Receita' },
    ...Object.fromEntries(
      items.map((item, index) => [
        `slice-${index}`,
        { label: item.label, color: SLICE_COLORS[index % SLICE_COLORS.length] },
      ]),
    ),
  } satisfies ChartConfig;

  const total = items.reduce((sum, item) => sum + item.value, 0);
  const leader = items[0]!;
  const summary = `${title}. Total ${formatCurrency(total)}. Maior fatia: ${leader.label} (${formatCurrency(leader.value)}).`;

  return (
    <Card className="h-full min-w-0">
      <CardHeader className="items-center text-center">
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
      </CardHeader>

      <ChartContainer
        config={chartConfig}
        className="mx-auto aspect-square max-h-[220px] w-full min-w-0 overflow-hidden"
        aria-label={summary}
      >
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                hideLabel
                nameKey="slice"
                formatter={(value, _name, item) => {
                  const payload = item.payload as { label?: string } | undefined;
                  return (
                    <div className="flex w-full items-center justify-between gap-4">
                      <span className="text-muted-foreground">{payload?.label ?? 'Categoria'}</span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {formatCurrency(Number(value))}
                      </span>
                    </div>
                  );
                }}
              />
            }
          />
          <Pie data={chartData} dataKey="value" nameKey="slice" innerRadius={58} strokeWidth={4}>
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !('cx' in viewBox) || !('cy' in viewBox)) return null;
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) - 4} className="fill-foreground font-display text-lg">
                      {formatCurrency(total, { compact: true })}
                    </tspan>
                    <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 16} className="fill-muted-foreground text-[11px]">
                      receita
                    </tspan>
                  </text>
                );
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>

      <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
        {items.map((item, index) => (
          <li key={item.key} className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: SLICE_COLORS[index % SLICE_COLORS.length] }}
            />
            <span className="truncate">{item.label}</span>
          </li>
        ))}
      </ul>

      <CardFooter className="justify-center pt-0 text-xs text-muted-foreground">
        {leader.label} lidera o mix
      </CardFooter>

      <AccessibleChartTable
        caption={summary}
        labelHeader="Categoria"
        valueHeader="Receita"
        rows={items.map((item) => ({
          key: item.key,
          label: item.label,
          value: formatCurrency(item.value),
        }))}
      />
    </Card>
  );
}
