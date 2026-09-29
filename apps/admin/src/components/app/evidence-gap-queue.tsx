'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Badge, severityTone, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';

export type EvidenceGapQueueItem = {
  id: string;
  tenant: { id: string; name: string };
  plan: { id: string; title: string } | null;
  subject: string;
  reason: string;
  impact: string;
  status: string;
  attempts: number;
  assignee: { id: string; name: string } | null;
  nextStep: string | null;
  nextAttemptAllowedAt: string | null;
  createdAt: string;
  clarification: {
    id: string;
    status: string;
    question: string;
    contactLabel: string;
    sentAt: string | null;
    answeredAt: string | null;
    error: string | null;
  } | null;
};

export type ClarificationContact = {
  id: string;
  tenantId: string;
  label: string;
};

const STATUS_LABELS: Record<string, string> = { new: 'Nova', in_progress: 'Em tratamento', waiting_source: 'Aguardando fonte', waiting_response: 'Aguardando resposta', resolved: 'Resolvida', unresolved: 'Sem resolução' };

const CLARIFICATION_LABELS: Record<string, string> = {
  queued: 'Preparada',
  sending: 'Enviando',
  sent: 'Aguardando resposta',
  answered: 'Respondida',
  ambiguous: 'Resposta ambígua',
  failed: 'Falha no envio',
  cancelled: 'Cancelada',
};

export function EvidenceGapQueue({
  items,
  contacts,
}: {
  items: EvidenceGapQueueItem[];
  contacts: ClarificationContact[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function update(id: string, payload: Record<string, unknown>) {
    setPendingId(id); setError(null);
    const response = await fetch(`/api/v1/evidence-gaps/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    setPendingId(null);
    if (!response.ok) { setError(body?.error?.message ?? 'Não foi possível atualizar a lacuna.'); return; }
    router.refresh();
  }

  async function prepareClarification(item: EvidenceGapQueueItem) {
    const available = contacts.filter((contact) => contact.tenantId === item.tenant.id);
    if (available.length === 0) {
      setError('Esta empresa não tem número de WhatsApp autorizado para consulta.');
      return;
    }
    const contact = available[0]!;
    const question = window.prompt(
      `Pergunta curta para ${contact.label} sobre "${item.subject}":`,
      `Sobre ${item.subject}: você pode confirmar o que aconteceu?`,
    );
    if (!question?.trim()) return;

    setPendingId(item.id);
    setError(null);
    const response = await fetch(`/api/v1/evidence-gaps/${item.id}/clarification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numberId: contact.id, question: question.trim() }),
    });
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    setPendingId(null);
    if (!response.ok) {
      setError(body?.error?.message ?? 'Não foi possível preparar a consulta.');
      return;
    }
    await update(item.id, {
      status: 'waiting_response',
      incrementAttempts: true,
      nextStep: 'Aguardar esclarecimento no canal autorizado',
    });
  }

  return <div className="flex flex-col gap-3">{error ? <Alert tone="danger">{error}</Alert> : null}<DataTable caption="Lacunas e conflitos de evidência" captionVisible rows={items} rowKey={(item) => item.id} emptyLabel="Nenhuma lacuna com estes filtros." columns={[
    { key: 'impact', header: 'Impacto', render: (item) => <Badge tone={severityTone(item.impact)}>{item.impact}</Badge> },
    { key: 'company', header: 'Empresa / plano', render: (item) => <div><p className="font-medium">{item.tenant.name}</p><p className="text-xs text-muted-foreground">{item.plan?.title ?? 'Sem plano vinculado'}</p></div> },
    { key: 'gap', header: 'Lacuna', render: (item) => <div className="max-w-md"><p className="font-medium">{item.subject}</p><p className="mt-1 text-xs text-muted-foreground">{item.reason}</p></div> },
    { key: 'status', header: 'Estado', render: (item) => <div><Badge tone={statusTone(item.status)}>{STATUS_LABELS[item.status] ?? item.status}</Badge><p className="mt-1 text-xs text-muted-foreground">{item.attempts} tentativa(s){item.assignee ? ` · ${item.assignee.name}` : ' · sem responsável'}</p></div> },
    { key: 'clarification', header: 'Esclarecimento', render: (item) => item.clarification ? <div className="max-w-xs"><Badge tone={item.clarification.status === 'answered' ? 'success' : item.clarification.status === 'failed' || item.clarification.status === 'cancelled' ? 'danger' : item.clarification.status === 'ambiguous' ? 'warning' : 'info'}>{CLARIFICATION_LABELS[item.clarification.status] ?? item.clarification.status}</Badge><p className="mt-1 text-xs text-muted-foreground">{item.clarification.contactLabel}{item.clarification.sentAt ? ` · enviado ${new Date(item.clarification.sentAt).toLocaleString('pt-BR')}` : ''}</p>{item.clarification.error ? <p className="mt-1 text-xs text-danger">{item.clarification.error}</p> : null}</div> : <span className="text-xs text-muted-foreground">Nenhuma consulta</span> },
    { key: 'next', header: 'Próximo passo', render: (item) => <div className="max-w-xs"><p>{item.nextStep ?? 'Definir tratamento'}</p>{item.nextAttemptAllowedAt ? <p className="mt-1 text-xs text-muted-foreground">Após {new Date(item.nextAttemptAllowedAt).toLocaleString('pt-BR')}</p> : null}</div> },
    { key: 'actions', header: 'Ações', render: (item) => <div className="flex min-w-64 flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={pendingId === item.id} onClick={() => void update(item.id, { status: 'in_progress', nextStep: 'Reconciliar fontes e configuração' })}>Reconciliar</Button><Button size="sm" variant="secondary" disabled={pendingId === item.id || item.clarification?.status === 'sent' || item.clarification?.status === 'queued'} onClick={() => void prepareClarification(item)}>Preparar consulta</Button><Button size="sm" variant="default" disabled={pendingId === item.id} onClick={() => void update(item.id, { status: 'resolved', resolution: { kind: 'ops_reconciled' }, nextStep: null })}>Resolver</Button><Button size="sm" variant="danger" disabled={pendingId === item.id} onClick={() => void update(item.id, { status: 'unresolved', resolution: { kind: 'limitation_recorded' }, nextStep: null })}>Registrar limitação</Button></div> },
  ]} /></div>;
}
