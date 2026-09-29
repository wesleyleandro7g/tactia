'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/format';

export function CommandCenterRelease({ tenantId, enabled }: { tenantId: string; enabled: boolean | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = enabled === true;

  async function update() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/tenants/${tenantId}/command-center`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !active }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
        throw new Error(errorMessage(body?.error?.code, body?.error?.message));
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao atualizar');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-muted-foreground">
        {enabled === null
          ? 'Sem decisão registrada. A configuração de desenvolvimento ainda pode ativar esta empresa.'
          : active ? 'Nova navegação ativa para esta empresa.' : 'Navegação anterior ativa para esta empresa.'}
      </p>
      <Button type="button" variant="secondary" loading={pending} onClick={() => void update()}>
        {pending ? 'Salvando…' : active ? 'Desativar Central de Comando' : 'Ativar Central de Comando'}
      </Button>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
