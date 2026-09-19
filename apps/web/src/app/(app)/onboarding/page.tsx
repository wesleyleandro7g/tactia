import Link from 'next/link';
import { PageHeader } from '@/components/app/page-header';
import { getServerContext } from '@/lib/server-context';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Preparação do acesso · Tactia' };

export default async function OnboardingPage() {
  const ctx = await getServerContext();
  if (!ctx.userId) redirect('/login?returnTo=%2Fonboarding');
  if (ctx.tenantId) redirect('/dashboard');

  return (
    <div className="flex flex-col gap-2">
      <PageHeader
        title="Vamos preparar seu acesso"
        description="O cadastro da empresa e dos usuários é feito pela equipe Tactia, com acompanhamento próximo. Se você já está em atendimento, aguarde a liberação do seu acesso."
      />
      <Link href="/signup" className="mt-4 text-sm text-primary underline underline-offset-4">
        Solicitar consultoria gratuita
      </Link>
    </div>
  );
}
