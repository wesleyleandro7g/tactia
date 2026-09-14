'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth-client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? 'Não foi possível entrar');
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-md flex-col gap-8">
        <div>
          <p className="font-mono text-sm font-semibold tracking-[0.18em] text-primary">TACTIA</p>
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-muted-foreground">Ops console</p>
        </div>
        <Card>
          <h1 className="font-mono text-lg">Entrar</h1>
          <p className="mt-1 mb-5 text-sm text-muted-foreground">Acesso restrito a operadores internos.</p>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <Field htmlFor="email" label="Email">
              <Input
                id="email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field htmlFor="password" label="Senha">
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <Button type="submit" loading={pending} size="md" className="w-full">
              {pending ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
