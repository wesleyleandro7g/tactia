'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/format';

/**
 * Dispara o pipeline determinístico (regras → insights → recomendações) para o
 * período exibido. É o mesmo `POST /api/v1/insights` usado pelo worker.
 */
export function RunPipelineButton({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    setResult(null);

    const response = await fetch('/api/v1/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodFrom: from, periodTo: to }),
    });

    setPending(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(body?.error?.code));
      return;
    }

    const body = (await response.json()) as {
      data: { insightsCreated: number; recommendationsCreated: number };
    };
    setResult(
      `${body.data.insightsCreated} insight(s) e ${body.data.recommendationsCreated} recomendação(ões) criados.`,
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button size="sm" variant="secondary" loading={pending} onClick={() => void run()}>
        Rodar análise
      </Button>
      {result ? (
        <p aria-live="polite" className="text-xs text-muted">
          {result}
        </p>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
