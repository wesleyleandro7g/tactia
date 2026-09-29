'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/format';

export type SuggestedPlanAction = {
  actionType: 'create_task' | 'send_email';
  input: Record<string, unknown>;
  reason: string;
};

export function PlanExecutionAction({
  planId,
  planVersion,
  stepId,
  action,
}: {
  planId: string;
  planVersion: number;
  stepId: string;
  action: SuggestedPlanAction;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function propose() {
    setLoading(true);
    setError(null);
    const response = await fetch(`/api/v1/plans/${planId}/steps/${stepId}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `plan:${planId}:v${planVersion}:step:${stepId}`,
      },
      body: JSON.stringify(action),
    });
    const body = await response.json().catch(() => null) as {
      data?: { link?: { approvalId?: string | null }; execution?: { status?: string } };
      error?: { code?: string; message?: string };
    } | null;
    setLoading(false);
    if (!response.ok) {
      setError(errorMessage(body?.error?.code, body?.error?.message));
      return;
    }
    if (body?.data?.link?.approvalId) router.push('/operations?tab=decisions');
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <Alert tone="info" title="Ação preparada">
        {action.actionType === 'send_email'
          ? 'O conteúdo e os destinatários serão revisados antes do envio.'
          : 'A tarefa será criada no processo existente e acompanhada pelas fontes.'}
      </Alert>
      <Button size="md" loading={loading} onClick={() => void propose()}>
        {action.actionType === 'send_email' ? 'Revisar envio' : 'Enviar para decisão'}
      </Button>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
