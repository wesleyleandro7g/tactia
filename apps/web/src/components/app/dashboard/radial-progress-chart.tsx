'use client';

import { Label, PolarGrid, PolarRadiusAxis, RadialBar, RadialBarChart } from 'recharts';

import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import { AccessibleChartTable } from '@/components/app/dashboard/accessible-chart-table';
import type { RadialProgress } from '@/lib/radial-progress';

export function RadialProgressChart({ progress }: { progress: RadialProgress }) {
  const pct = Math.max(0, Math.min(1, progress.progress));
  const chartData = [{ name: 'progress', value: Math.round(pct * 100), fill: 'var(--color-progress)' }];
  const chartConfig = {
    progress: { label: progress.valueLabel, color: 'var(--chart-2)' },
  } satisfies ChartConfig;
  const summary = `${progress.title}: ${progress.label} ${progress.valueLabel}. ${progress.detail}`;

  return (
    <Card className="h-full min-w-0">
      <CardHeader className="items-center text-center">
        <div>
          <CardTitle>{progress.title}</CardTitle>
          {progress.description ? <CardDescription>{progress.description}</CardDescription> : null}
        </div>
      </CardHeader>

      <ChartContainer
        config={chartConfig}
        className="mx-auto aspect-square max-h-[220px] w-full min-w-0 overflow-hidden"
        aria-label={summary}
      >
        <RadialBarChart
          data={chartData}
          startAngle={90}
          endAngle={90 - 360 * Math.max(pct, 0.02)}
          innerRadius={72}
          outerRadius={96}
        >
          <PolarGrid
            gridType="circle"
            radialLines={false}
            stroke="none"
            className="first:fill-muted last:fill-card"
            polarRadius={[98, 70]}
          />
          <RadialBar dataKey="value" background cornerRadius={10} />
          <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !('cx' in viewBox) || !('cy' in viewBox)) return null;
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground font-display text-3xl">
                      {progress.label}
                    </tspan>
                    <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 20} className="fill-muted-foreground text-xs">
                      {progress.valueLabel}
                    </tspan>
                  </text>
                );
              }}
            />
          </PolarRadiusAxis>
        </RadialBarChart>
      </ChartContainer>

      <CardFooter className="justify-center pt-0 text-center text-xs text-muted-foreground">
        {progress.detail}
      </CardFooter>

      <AccessibleChartTable
        caption={summary}
        labelHeader="Indicador"
        valueHeader="Valor"
        rows={[{ key: 'progress', label: progress.title, value: `${progress.label} — ${progress.detail}` }]}
      />
    </Card>
  );
}
