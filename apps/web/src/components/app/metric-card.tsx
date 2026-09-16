import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { Sparkline } from '@/components/app/dashboard/sparkline';
import { Card, CardLabel } from '@/components/ui/card';
import type { ChartPoint } from '@/lib/chart';
import { cn } from '@/lib/cn';
import { formatPercentDelta } from '@/lib/format';

export type MetricCardProps = {
  label: string;
  value: string;
  /** Fração: 0.12 = +12%. Ausente esconde a linha de comparação. */
  deltaFraction?: number | undefined;
  comparisonLabel?: string;
  hint?: string;
  emphasis?: boolean;
  size?: 'default' | 'sm';
  sparkline?: ChartPoint[];
  sparklineColor?: string;
};

/**
 * Card de métrica do dashboard (spec §57).
 * A variação vem sempre com texto — a seta é decorativa.
 */
export function MetricCard({
  label,
  value,
  deltaFraction,
  comparisonLabel = 'vs. período anterior',
  hint,
  emphasis = false,
  size = 'default',
  sparkline,
  sparklineColor,
}: MetricCardProps) {
  const id = `metric-${label.toLowerCase().replace(/\s+/g, '-')}`;
  const direction =
    deltaFraction === undefined ? 'none' : deltaFraction > 0.001 ? 'up' : deltaFraction < -0.001 ? 'down' : 'flat';

  const Icon = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : ArrowRight;
  const tone =
    direction === 'up' ? 'text-success' : direction === 'down' ? 'text-danger' : 'text-muted-foreground';

  return (
    <Card
      role="article"
      aria-labelledby={id}
      className={cn(
        'flex flex-col gap-2',
        size === 'sm' ? 'p-4' : 'p-5',
        emphasis && 'border-primary/35 bg-accent-soft',
      )}
    >
      <CardLabel id={id}>{label}</CardLabel>
      <p
        className={cn(
          'tabular font-display tracking-tight text-foreground',
          size === 'sm' ? 'text-xl' : 'text-3xl',
        )}
      >
        {value}
      </p>
      {direction !== 'none' && deltaFraction !== undefined ? (
        <p className={cn('flex items-center gap-1 text-xs', tone)}>
          <Icon aria-hidden="true" className="size-3.5 shrink-0" />
          <span>
            <span className="font-medium">{formatPercentDelta(deltaFraction)}</span>{' '}
            <span className="text-muted-foreground">{comparisonLabel}</span>
          </span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{hint ?? 'sem comparação disponível'}</p>
      )}
      {hint && direction !== 'none' ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
      {sparkline && sparkline.length > 1 ? (
        <div className="mt-auto pt-2">
          <Sparkline points={sparkline} color={sparklineColor} label={label} />
        </div>
      ) : null}
    </Card>
  );
}
