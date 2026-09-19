import { OAuthConsent } from '@/components/app/oauth-consent';
import { requireUser } from '@/lib/server-context';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { prisma } from '@tactia/database';
import { getMcpCompany } from '@/lib/mcp-oauth-selection';

export const metadata = { title: 'Autorizar ChatGPT · Tactia' };

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser('/oauth/consent');
  const query = await searchParams;
  const scopes = (typeof query.scope === 'string' ? query.scope : '').split(/\s+/).filter(Boolean);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const entry of Array.isArray(value) ? value : value ? [value] : []) params.append(key, entry);
  }
  const session = await auth.api.getSession({ headers: await headers() });
  const tenantId = session ? await getMcpCompany(session.session.id, params) : null;
  const tenant = tenantId ? await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }) : null;
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      {tenant ? <OAuthConsent scopes={scopes} companyName={tenant.name} /> : (
        <p role="alert">A seleção da empresa expirou. Inicie novamente a conexão pelo ChatGPT.</p>
      )}
    </main>
  );
}
