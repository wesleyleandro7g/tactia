'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-8">
      <Alert tone="danger" title="Não foi possível carregar esta visão">
        O que já foi registrado permanece preservado. Tente novamente; se a falha continuar, a equipe Tactia poderá localizar o incidente pelo identificador da requisição.
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Button size="md" onClick={reset}>Tentar novamente</Button>
        <Link href="/objectives" className={cn(buttonVariants({ variant: 'outline', size: 'md' }))}>
          Ir para Objetivos
        </Link>
      </div>
    </div>
  );
}
