import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, formatInteger, metricLabel } from '@/lib/format';
import type { Availability, ObjectiveView } from './types';

function valueLabel(value: number, metricKey: string) {
  return metricKey.includes('revenue') || metricKey.includes('amount') ? formatCurrency(value) : formatInteger(value);
}

export function ObjectiveProgress({
  objective,
  actual,
  availability,
  updatedAt,
  limitation,
}: {
  objective: ObjectiveView;
  actual: number | null;
  availability: Availability;
  updatedAt?: string | null;
  limitation?: string | null;
}) {
  const evaluable = actual !== null && availability !== 'error' && availability !== 'empty';
  const ratio = evaluable && objective.target !== 0 ? Math.max(0, Math.min(1, actual / objective.target)) : null;
  const reached = evaluable && actual >= objective.target;
  return (
    <Card aria-labelledby={`objective-${objective.id}`}>
      <CardHeader>
        <div>
          <CardTitle id={`objective-${objective.id}`}>
            <Link href={`/objectives/${objective.id}`} className="underline-offset-4 hover:underline">
              {objective.title ?? metricLabel(objective.metricKey)}
            </Link>
          </CardTitle>
          <CardDescription>{metricLabel(objective.metricKey)}</CardDescription>
        </div>
        <Badge tone={reached ? 'success' : evaluable ? 'info' : 'warning'}>
          {reached ? 'Atingido' : evaluable ? 'Em acompanhamento' : 'Não avaliável'}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-4 min-[480px]:grid-cols-2">
          <div className="min-w-0"><dt className="text-xs uppercase tracking-wide text-muted-foreground">Realizado</dt><dd className="mt-1 break-words text-2xl font-medium tabular">{evaluable ? valueLabel(actual, objective.metricKey) : '—'}</dd></div>
          <div className="min-w-0"><dt className="text-xs uppercase tracking-wide text-muted-foreground">Meta</dt><dd className="mt-1 break-words text-2xl font-medium tabular">{valueLabel(objective.target, objective.metricKey)}</dd></div>
        </dl>
        {ratio !== null ? <div><div role="progressbar" aria-label="Progresso do objetivo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${ratio * 100}%` }} /></div><p className="mt-2 text-sm text-muted-foreground">{Math.round(ratio * 100)}% da meta observada{updatedAt ? ` · fonte até ${updatedAt}` : ''}</p></div> : null}
        {limitation || !evaluable ? <Alert tone="warning" title={evaluable ? 'Cobertura limitada' : 'Não foi possível avaliar'}>{limitation ?? 'A fonte necessária está sendo verificada pela equipe Tactia. Nenhum valor foi substituído por zero.'}</Alert> : null}
      </CardContent>
    </Card>
  );
}
