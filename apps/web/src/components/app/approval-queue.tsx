'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Input } from '@/components/ui/field';
import {
  ACTION_TYPE_LABELS,
  EXECUTION_STATUS_LABELS,
  errorMessage,
  formatDateTime,
} from '@/lib/format';

export type ApprovalView = {
  id: string;
  status: string;
  reason: string | null;
  createdAt: string;
  requestedBy: string | null;
  execution: {
    id: string;
    status: string;
    origin: string;
    input: Record<string, unknown>;
    output: Record<string, unknown> | null;
    error: string | null;
    actionType: string;
    actionName: string;
  };
};

const ORIGIN_LABELS: Record<string, string> = {
  user: 'pedido por um usuário',
  ai: 'proposto pela Tactia',
  system: 'gerado pelo sistema',
};

/**
 * Fila de aprovações (human-in-the-loop, spec §3.5).
 * Aprovar executa a ação e a resposta já traz o resultado registrado.
 */
export function ApprovalQueue({
  approvals,
  canDecide,
}: {
  approvals: ApprovalView[];
  canDecide: boolean;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, ApprovalView['execution']>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function decide(approval: ApprovalView, decision: 'approve' | 'reject') {
    setPendingId(approval.id);
    setErrors((current) => ({ ...current, [approval.id]: '' }));

    const response = await fetch(`/api/v1/approvals/${approval.id}/${decision}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reasons[approval.id] || undefined }),
    });

    setPendingId(null);

    const body = (await response.json().catch(() => null)) as
      | { data?: { status: string; output?: Record<string, unknown>; error?: string }; error?: { code?: string } }
      | null;

    if (!response.ok) {
      setErrors((current) => ({
        ...current,
        [approval.id]: errorMessage(body?.error?.code),
      }));
      return;
    }

    setResults((current) => ({
      ...current,
      [approval.id]: {
        ...approval.execution,
        status: body?.data?.status ?? approval.execution.status,
        output: body?.data?.output ?? null,
        error: body?.data?.error ?? null,
      },
    }));
    router.refresh();
  }

  if (approvals.length === 0) {
    return (
      <EmptyState
        title="Nenhuma aprovação pendente"
        description="Ações propostas pela Tactia ou pela equipe aparecem aqui antes de executar."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {approvals.map((approval) => {
        const busy = pendingId === approval.id;
        const result = results[approval.id];
        const execution = result ?? approval.execution;
        const error = errors[approval.id];

        return (
          <li key={approval.id}>
            <Card aria-busy={busy || undefined}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {ACTION_TYPE_LABELS[execution.actionType] ?? execution.actionName}
                  </p>
                  <p className="text-xs text-muted">
                    {ORIGIN_LABELS[execution.origin] ?? execution.origin} ·{' '}
                    {formatDateTime(approval.createdAt)}
                  </p>
                </div>
                <Badge tone={statusTone(execution.status)}>
                  {EXECUTION_STATUS_LABELS[execution.status] ?? execution.status}
                </Badge>
              </div>

              {approval.reason ? (
                <p className="mt-3 text-sm text-muted">Motivo: {approval.reason}</p>
              ) : null}

              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {Object.entries(execution.input).map(([key, value]) => (
                  <div key={key} className="col-span-2 grid grid-cols-subgrid">
                    <dt className="text-xs uppercase tracking-wide text-muted">{key}</dt>
                    <dd className="break-words">{String(value)}</dd>
                  </div>
                ))}
              </dl>

              {execution.output ? (
                <Alert tone="success" className="mt-3" title="Execução registrada">
                  {Object.entries(execution.output)
                    .map(([key, value]) => `${key}: ${String(value)}`)
                    .join(' · ')}
                </Alert>
              ) : null}

              {execution.error ? (
                <Alert tone="danger" className="mt-3" title="A execução falhou">
                  {execution.error}
                </Alert>
              ) : null}

              {error ? (
                <Alert tone="danger" className="mt-3">
                  {error}
                </Alert>
              ) : null}

              {result === undefined && approval.status === 'pending' ? (
                canDecide ? (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <label htmlFor={`reason-${approval.id}`} className="sr-only">
                      Motivo da decisão
                    </label>
                    <Input
                      id={`reason-${approval.id}`}
                      placeholder="Motivo (opcional)"
                      value={reasons[approval.id] ?? ''}
                      onChange={(event) =>
                        setReasons((current) => ({ ...current, [approval.id]: event.target.value }))
                      }
                      className="sm:max-w-xs"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="success"
                        loading={busy}
                        onClick={() => void decide(approval, 'approve')}
                      >
                        Aprovar e executar
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy}
                        onClick={() => void decide(approval, 'reject')}
                      >
                        Rejeitar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-muted">
                    Apenas owner ou admin pode aprovar ou rejeitar.
                  </p>
                )
              ) : null}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
