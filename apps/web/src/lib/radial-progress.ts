import { formatCurrency, formatInteger, metricLabel } from '@/lib/format';

const COUNT_METRICS = new Set([
  'sales_count',
  'customer_count',
  'units_sold',
  'new_customers',
  'complaint_count',
]);

export type RadialProgress = {
  title: string;
  description?: string;
  label: string;
  valueLabel: string;
  progress: number;
  detail: string;
};

export function goalRadialProgress(goal: {
  metricKey: string;
  achieved: number;
  target: number;
  progress: number;
  onTrack: boolean | null;
}): RadialProgress {
  const money = !COUNT_METRICS.has(goal.metricKey);
  const formatValue = (value: number) => (money ? formatCurrency(value) : formatInteger(value));
  const pct = Math.round(goal.progress * 100);
  return {
    title: 'Meta',
    description: metricLabel(goal.metricKey),
    label: `${pct}%`,
    valueLabel: 'da meta',
    progress: goal.progress,
    detail: `${formatValue(goal.achieved)} de ${formatValue(goal.target)}${
      goal.onTrack == null ? '' : goal.onTrack ? ' · no ritmo' : ' · abaixo do ritmo'
    }`,
  };
}

export function marginRadialProgress(margin: number, revenue: number): RadialProgress {
  const rate = revenue > 0 ? margin / revenue : 0;
  return {
    title: 'Margem bruta',
    description: 'Sobre a receita do período',
    label: `${Math.round(rate * 100)}%`,
    valueLabel: 'margem',
    progress: rate,
    detail: `${formatCurrency(margin)} de ${formatCurrency(revenue)}`,
  };
}
