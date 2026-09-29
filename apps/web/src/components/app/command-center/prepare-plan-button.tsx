'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/format';

export function PreparePlanButton({
  recommendationId,
  goalId,
}: {
  recommendationId: string;
  goalId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function prepare() {
    setLoading(true);
    setError(null);
    const response = await fetch(`/api/v1/recommendations/${recommendationId}/prepare-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalId }),
    });
    const body = await response.json().catch(() => null) as {
      data?: { id?: string };
      error?: { code?: string; message?: string };
    } | null;
    setLoading(false);
    if (!response.ok || !body?.data?.id) {
      setError(errorMessage(body?.error?.code, body?.error?.message));
      return;
    }
    router.push(`/operations/plans/${body.data.id}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <Button size="md" loading={loading} onClick={() => void prepare()}>
        Preparar plano
      </Button>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
