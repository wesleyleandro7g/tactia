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

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [company, setCompany] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const signup = await authClient.signUp.email({ name, email, password });
    if (signup.error) {
      setPending(false);
      setError(signup.error.message ?? 'Não foi possível criar a conta');
      return;
    }

    const response = await fetch('/api/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: company }),
    });
    const payload = (await response.json()) as { error?: { message: string } };
    setPending(false);
    if (!response.ok) {
      setError(payload.error?.message ?? 'Conta criada, mas a empresa falhou');
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
            <CardTitle className="font-display text-3xl tracking-tight">Criar empresa</CardTitle>
            <CardDescription>Configure sua conta e comece a usar a Tactia.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-5">
              <Field htmlFor="name" label="Seu nome">
                <Input id="name" required className="h-10" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
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
              <Field htmlFor="company" label="Nome da empresa">
                <Input
                  id="company"
                  required
                  minLength={2}
                  className="h-10"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </Field>
              {error ? <Alert tone="danger">{error}</Alert> : null}
              <Button type="submit" loading={pending} size="md" className="w-full">
                {pending ? 'Criando…' : 'Criar e entrar'}
              </Button>
            </form>
            <p className="mt-5 text-sm text-muted-foreground">
              Já tem conta?{' '}
              <Link href="/login" className="text-primary hover:underline">
                Entrar
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
