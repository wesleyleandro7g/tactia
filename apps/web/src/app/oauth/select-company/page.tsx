import { OAuthCompanySelection } from '@/components/app/oauth-company-selection';
import { requireUser, listUserTenants } from '@/lib/server-context';

export const metadata = { title: 'Conectar ChatGPT · Tactia' };

export default async function OAuthSelectCompanyPage() {
  const ctx = await requireUser('/oauth/select-company');
  const tenants = await listUserTenants(ctx);
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <OAuthCompanySelection
        tenants={tenants.map((tenant) => ({
          id: tenant.id,
          name: tenant.name,
          role: tenant.role,
        }))}
      />
    </main>
  );
}
