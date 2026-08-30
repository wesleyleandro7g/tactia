'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/format';

type Endpoint = 'sync' | 'reprocess-import';

/**
 * Botão de ação do operador. Chama as rotas `/api/v1/admin/*`, que validam a
 * allowlist no servidor — o gate nunca depende do cliente.
 */
export function OperatorActionButton({
  endpoint,
  payload,
  label,
  pendingLabel = 'Executando…',
}: {
  endpoint: Endpoint;
  payload: Record<string, string>;
  label: string;
  pendingLabel?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    setMessage(null);

    const response = await fetch(`/api/v1/admin/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => null)) as
      | { data?: { id?: string; status?: string; error?: string | null }; error?: { code?: string } }
      | null;

    setPending(false);

    if (!response.ok) {
      setError(errorMessage(body?.error?.code));
      return;
    }

    setMessage(
      body?.data?.status
        ? `Job ${body.data.id?.slice(0, 8)} — status ${body.data.status}`
        : 'Solicitado.',
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button size="sm" variant="secondary" loading={pending} onClick={() => void run()}>
        {pending ? pendingLabel : label}
      </Button>
      {message ? (
        <p aria-live="polite" className="text-xs text-muted">
          {message}
        </p>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
