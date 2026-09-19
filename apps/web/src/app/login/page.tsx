'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { AuthAtmosphere } from '@/components/app/auth-atmosphere';
import { BrandLogo } from '@/components/app/brand-logo';
import { ThemeToggle } from '@/components/app/theme-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
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
    router.push('/app');
    router.refresh();
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-12">
      <AuthAtmosphere />
      <div className="absolute top-4 right-4 z-20 sm:top-6 sm:right-6">
        <ThemeToggle />
      </div>
      <div className="relative z-10 flex w-full max-w-md animate-page-enter flex-col items-center gap-8">
        <Link href="/" className="inline-flex">
          <BrandLogo className="h-10" priority />
        </Link>
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="font-display text-3xl tracking-tight">Entrar</CardTitle>
            <CardDescription>Acesse a camada de inteligência operacional da sua empresa.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-5">
              <Field htmlFor="email" label="Email">
                <Input
                  id="email"
                  type="email"
                  required
                  className="h-10"
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
                  className="h-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              {error ? <Alert tone="danger">{error}</Alert> : null}
              <Button type="submit" loading={pending} size="md" className="w-full">
                {pending ? 'Entrando…' : 'Entrar'}
              </Button>
            </form>
            <p className="mt-5 text-sm text-muted-foreground">
              Não tem conta?{' '}
              <Link href="/signup" className="text-primary hover:underline">
                Consultoria gratuita
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
