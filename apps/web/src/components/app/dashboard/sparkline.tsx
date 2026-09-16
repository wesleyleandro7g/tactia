'use client';

import { useId } from 'react';
import { Area, AreaChart } from 'recharts';

import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import type { ChartPoint } from '@/lib/chart';

export function Sparkline({
  points,
  color = 'var(--chart-1)',
  label,
}: {
  points: ChartPoint[];
  color?: string;
  label: string;
}) {
  const gradientId = useId().replace(/:/g, '');
  if (points.length < 2) return null;

  const chartData = points.map((point) => ({ date: point.key, value: point.value }));
  const chartConfig = {
    value: { label, color },
  } satisfies ChartConfig;

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-10 w-full" aria-hidden="true">
      <AreaChart data={chartData} margin={{ top: 2, left: 0, right: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`spark-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          dataKey="value"
          type="monotone"
          fill={`url(#spark-${gradientId})`}
          stroke="var(--color-value)"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
