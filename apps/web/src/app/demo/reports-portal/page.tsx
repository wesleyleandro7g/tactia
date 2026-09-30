import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DEMO_REPORTS_COOKIE, demoPortalAuthorized, demoPortalPassword, demoPortalSessionValue } from '@/lib/demo-reports-portal';

export const metadata = { title: 'Portal de relatórios · Tactia' };

async function login(formData: FormData) {
  'use server';
  const password = demoPortalPassword();
  const given = String(formData.get('password') ?? '');
  if (!password || given !== password) redirect('/demo/reports-portal?error=1');
  (await cookies()).set(DEMO_REPORTS_COOKIE, demoPortalSessionValue(password), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/demo/reports-portal',
  });
  redirect('/demo/reports-portal');
}

export default async function DemoReportsPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const query = await searchParams;
  const signedIn = await demoPortalAuthorized();
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-4 p-6">
      <h1 className="text-2xl font-medium">Portal de relatórios</h1>
      <p className="text-sm text-muted-foreground">Ambiente isolado com dados fictícios de vendas, estoque e financeiro.</p>
      {signedIn ? (
        <ul className="flex flex-col gap-2 text-sm">
          <li><a className="underline" href="/demo/reports-portal/reports/sales?from=2026-09-01&to=2026-09-30">Baixar vendas</a></li>
          <li><a className="underline" href="/demo/reports-portal/reports/inventory?from=2026-09-01&to=2026-09-30">Baixar estoque</a></li>
          <li><a className="underline" href="/demo/reports-portal/reports/financial?from=2026-09-01&to=2026-09-30">Baixar financeiro</a></li>
        </ul>
      ) : (
        <form action={login} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm" htmlFor="password">
            Senha
            <input id="password" name="password" type="password" required className="h-9 rounded-md border px-2" />
          </label>
          {query.error ? <p className="text-sm text-destructive">Senha incorreta.</p> : null}
          <button className="h-9 rounded-md bg-black px-3 text-sm text-white" type="submit">Entrar</button>
        </form>
      )}
    </main>
  );
}
