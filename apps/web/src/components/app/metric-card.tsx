import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { Card, CardLabel } from '@/components/ui/card';
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
        'flex flex-col gap-1',
        emphasis && 'border-primary/40 bg-accent-soft',
      )}
    >
      <CardLabel id={id}>{label}</CardLabel>
      <p className="tabular text-2xl font-semibold text-foreground">{value}</p>
      {direction !== 'none' && deltaFraction !== undefined ? (
        <p className={cn('flex items-center gap-1 text-xs', tone)}>
          <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
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
    </Card>
  );
}
