'use client'; // Error boundaries must be Client Components

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export default function TenantTabError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <Alert tone="danger" title="Não foi possível carregar esta seção.">
        {error.digest ? <span className="font-mono text-xs">Ref. {error.digest}</span> : 'Tente novamente em instantes.'}
      </Alert>
      <Button variant="secondary" onClick={() => retry()}>
        Tentar novamente
      </Button>
    </div>
  );
}
