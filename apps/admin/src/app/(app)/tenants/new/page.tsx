import Link from 'next/link';
import { PageHeader } from '@/components/app/page-header';
import { ProvisionTenantForm } from '@/components/app/provision-tenant-form';
import { requireOperator } from '@/lib/server-context';

export const metadata = { title: 'Nova empresa · Tactia Ops' };

export default async function NewTenantPage() {
  await requireOperator('/tenants/new');
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/" className="font-mono text-xs text-primary hover:underline">
          ← Empresas
        </Link>
        <PageHeader
          className="mt-2"
          title="Provisionar empresa"
          description="Cria o tenant e o usuário owner. A senha provisória deve ir por outro canal — não há e-mail de convite."
        />
      </div>
      <ProvisionTenantForm />
    </div>
  );
}
