import { CompanyProfileSettings } from '@/components/app/company-profile-settings';
import { requireTenant } from '@/lib/server-context';
import { companyKnowledgeService } from '@/lib/services';

export const metadata = { title: 'Perfil da empresa · Tactia' };

export default async function CompanyProfilePage() {
  const ctx = await requireTenant('/settings/company-profile');
  const profile = await companyKnowledgeService.profile(ctx);
  return <CompanyProfileSettings initial={profile} canEdit={ctx.role === 'owner' || ctx.role === 'admin'} />;
}
