import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import type { Availability, EvidenceView } from './types';

const kindLabel = { observed: 'Observado na fonte', reported: 'Relatado por pessoa', inferred: 'Inferência da Tactia' } as const;
const kindTone = { observed: 'neutral', reported: 'info', inferred: 'warning' } as const;

export function EvidencePanel({
  title = 'Evidências',
  definition,
  period,
  availability,
  items,
  limitation,
  open = false,
}: {
  title?: string;
  definition: string;
  period?: string | null;
  availability: Availability;
  items: EvidenceView[];
  limitation?: string | null;
  open?: boolean;
}) {
  return (
    <details className="rounded-xl border border-border bg-card" open={open}>
      <summary className="min-h-11 cursor-pointer px-5 py-3 font-medium focus-visible:outline-2">{title}</summary>
      <div className="flex flex-col gap-4 border-t border-border px-5 py-4">
        <div><h3 className="font-medium">Definição</h3><p className="mt-1 text-sm text-muted-foreground">{definition}{period ? ` · ${period}` : ''}</p></div>
        {limitation || availability !== 'ready' ? <Alert tone={availability === 'error' ? 'danger' : 'warning'} title="Cobertura da informação">{limitation ?? 'Esta evidência ainda não está completa.'}</Alert> : null}
        {items.length ? <ol className="flex flex-col gap-3">{items.map((item) => <li key={item.id} className="rounded-lg border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><Badge tone={kindTone[item.kind]}>{kindLabel[item.kind]}</Badge><time className="text-xs text-muted-foreground" dateTime={item.eventAt ?? item.ingestedAt}>{new Date(item.eventAt ?? item.ingestedAt).toLocaleString('pt-BR')}</time></div><p className="mt-2 text-sm">{item.summary}</p><p className="mt-1 text-xs text-muted-foreground">Fonte: {item.sourceLabel} · ingerido em {new Date(item.ingestedAt).toLocaleString('pt-BR')}</p></li>)}</ol> : <p className="text-sm text-muted-foreground">Nenhuma evidência disponível. A lacuna permanece explícita e sob tratamento operacional.</p>}
      </div>
    </details>
  );
}
