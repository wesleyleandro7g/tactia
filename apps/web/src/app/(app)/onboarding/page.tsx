import { CreateCompanyForm } from '@/components/app/create-company-form';
import { PageHeader } from '@/components/app/page-header';
import { getServerContext } from '@/lib/server-context';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Criar empresa · Tactia' };

export default async function OnboardingPage() {
  const ctx = await getServerContext();
  if (!ctx.userId) redirect('/login?returnTo=%2Fonboarding');
  if (ctx.tenantId) redirect('/dashboard');

  return (
    <div className="flex flex-col gap-2">
      <PageHeader
        title="Criar empresa"
        description="A conexão das fontes de dados é feita pela equipe Tactia. Aqui você só registra a empresa para começar a usar o app."
      />
      <CreateCompanyForm />
    </div>
  );
}
