'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { errorMessage, formatDateTime } from '@/lib/format';

export type ConnectionRow = {
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
  apiBasePath,
}: {
  connections: ConnectionRow[];
  apiBasePath: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(connections);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(id: string) {
    if (!window.confirm('Revogar esta conexão? Os tokens são bloqueados imediatamente.')) return;
    setPendingId(id);
    setError(null);
    const response = await fetch(`${apiBasePath}/${id}/revoke`, { method: 'POST' });
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
    <div className="flex flex-col gap-6">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            Nenhuma conexão ativa. Quando um app OAuth (ex.: ChatGPT) for conectado a esta empresa,
            a autorização aparece aqui.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((connection) => (
            <Card key={connection.id}>
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
                  variant="danger"
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
