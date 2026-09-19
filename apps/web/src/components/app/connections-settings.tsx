'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { errorMessage, formatDateTime } from '@/lib/format';

type ConnectionRow = {
  id: string;
  clientName: string;
  clientUri: string | null;
  userName: string;
  userEmail: string | null;
  scopes: string[];
  connectedAt: string;
};

export function ConnectionsSettings({
  connections,
  canManageCompany,
}: {
  connections: ConnectionRow[];
  canManageCompany: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(connections);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(id: string) {
    setPendingId(id);
    setError(null);
    const response = await fetch(`/api/v1/oauth/connections/${id}/revoke`, { method: 'POST' });
    setPendingId(null);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(body?.error?.code));
      return;
    }
    setRows((current) => current.filter((row) => row.id !== id));
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Conexões"
        description={
          canManageCompany
            ? 'Aplicativos com acesso OAuth a esta empresa. A revogação bloqueia os tokens imediatamente.'
            : 'Aplicativos autorizados por você para acessar esta empresa.'
        }
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {rows.length === 0 ? (
        <EmptyState
          title="Nenhuma conexão ativa"
          description="Quando o ChatGPT for conectado à Tactia, a autorização aparecerá aqui."
        />
      ) : (
        <div className="grid gap-3">
          {rows.map((connection) => (
            <Card key={connection.id} size="sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h2 className="font-medium text-foreground">{connection.clientName}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {connection.userName}
                    {connection.userEmail ? ` · ${connection.userEmail}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Conectado em {formatDateTime(connection.connectedAt)} ·{' '}
                    {connection.scopes.includes('tools:propose')
                      ? 'consultas e propostas'
                      : 'somente consultas'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  loading={pendingId === connection.id}
                  onClick={() => void revoke(connection.id)}
                >
                  Revogar
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
