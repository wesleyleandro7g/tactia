import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { MeasurementDefinitionView } from './types';

function display(value: number | null, unit: string) {
  if (value === null) return '—';
  if (unit === 'BRL') return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  if (unit === '%') return `${value.toLocaleString('pt-BR')}%`;
  return `${value.toLocaleString('pt-BR')} ${unit}`;
}

export function OutcomeReview({ definition }: { definition: MeasurementDefinitionView }) {
  const review = definition.reviews[0];
  const status = review?.status ?? 'measuring';
  const tone = status === 'measured' ? 'success' : status === 'not_measurable' ? 'danger' : 'warning';
  return (
    <Card>
      <CardHeader><div><CardTitle>{definition.indicator}</CardTitle><CardDescription>{new Date(definition.windowFrom).toLocaleDateString('pt-BR')} a {new Date(definition.windowTo).toLocaleDateString('pt-BR')} · definição v{definition.version}</CardDescription></div><Badge tone={tone}>{status === 'measured' ? 'Medido' : status === 'not_measurable' ? 'Não foi possível medir' : status === 'review_needed' ? 'Revisão necessária' : 'Em medição'}</Badge></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3"><div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Baseline</dt><dd className="mt-1 text-lg font-medium tabular">{display(definition.baseline, definition.unit)}</dd></div><div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Alvo</dt><dd className="mt-1 text-lg font-medium tabular">{display(definition.target, definition.unit)}</dd></div><div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Observado</dt><dd className="mt-1 text-lg font-medium tabular">{display(review?.observed ?? null, definition.unit)}</dd></div></dl>
        <Alert tone="info" title="Limite de atribuição">{definition.attribution}</Alert>
        {review?.limitation ? <Alert tone="warning" title="Limitação da medição">{review.limitation}</Alert> : null}
        {!review ? <p className="text-sm text-muted-foreground">A Tactia continua coletando evidências nas fontes conectadas. Nenhum check-in é necessário.</p> : null}
      </CardContent>
    </Card>
  );
}
