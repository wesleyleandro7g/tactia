'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ACTION_TYPE_LABELS, errorMessage } from '@/lib/format';

export type DecisionView = {
  id: string;
  status: string;
  reason: string | null;
  createdAt: string;
  versionLabel: string;
  canDecide: boolean;
  execution: {
    status: string;
    actionType: string;
    actionName: string;
    input: Record<string, unknown>;
  };
};

const FIELD_LABELS: Record<string, string> = { to: 'Destinatário', subject: 'Assunto', body: 'Conteúdo', customerId: 'Cliente', leadId: 'Lead', sellerId: 'Responsável', dueAt: 'Prazo', title: 'Tarefa' };

export function DecisionCard({ decision }: { decision: DecisionView }) {
  const router = useRouter();
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(kind: 'approve' | 'reject') {
    setPending(kind);
    setError(null);
    const response = await fetch(`/api/v1/approvals/${decision.id}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
    setPending(null);
    if (!response.ok) { setError(errorMessage(body?.error?.code, body?.error?.message)); return; }
    router.refresh();
  }

  const pendingDecision = decision.status === 'pending';
  return (
    <Card aria-busy={pending !== null || undefined}>
      <CardHeader>
        <div><CardTitle>{ACTION_TYPE_LABELS[decision.execution.actionType] ?? decision.execution.actionName}</CardTitle><CardDescription>Revisão por ação · {decision.versionLabel} · solicitada em {new Date(decision.createdAt).toLocaleString('pt-BR')}</CardDescription></div>
        <Badge tone={statusTone(decision.status)}>{pendingDecision ? 'Decisão pendente' : decision.status === 'approved' ? 'Aprovada' : 'Recusada'}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {decision.reason ? <p className="text-sm"><span className="font-medium">Motivo:</span> {decision.reason}</p> : null}
        <dl className="grid gap-3 sm:grid-cols-2">{Object.entries(decision.execution.input).map(([key, value]) => <div key={key} className={key === 'body' ? 'sm:col-span-2' : ''}><dt className="text-xs uppercase tracking-wide text-muted-foreground">{FIELD_LABELS[key] ?? key}</dt><dd className="mt-1 break-words text-sm">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>)}</dl>
        <Alert tone="info" title="O que esta decisão faz">Ao aprovar, a ação entra no estado efetivo retornado pelo executor. Uma ação concluída não significa que o objetivo comercial foi atingido.</Alert>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </CardContent>
      {pendingDecision ? <CardFooter className="flex flex-wrap gap-2">{decision.canDecide ? <><Button size="md" loading={pending === 'approve'} disabled={pending !== null} onClick={() => void decide('approve')}>Aprovar ação</Button><Button size="md" variant="danger" loading={pending === 'reject'} disabled={pending !== null} onClick={() => void decide('reject')}>Recusar</Button></> : <p className="text-sm text-muted-foreground">Seu papel permite consultar, mas não decidir esta ação.</p>}</CardFooter> : null}
    </Card>
  );
}
