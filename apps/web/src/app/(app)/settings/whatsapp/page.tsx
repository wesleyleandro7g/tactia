import { WhatsappSettings } from '@/components/app/whatsapp-settings';
import { requireTenant } from '@/lib/server-context';
import { userService, whatsappAgentConfigService, whatsappAuthorizedNumberService } from '@/lib/services';
import { hasMinRole } from '@tactia/domain';
import { redirect } from 'next/navigation';

export const metadata = { title: 'WhatsApp · Tactia' };

export default async function WhatsappSettingsPage() {
  const ctx = await requireTenant('/settings/whatsapp');
  if (!hasMinRole(ctx.role, 'admin')) redirect('/dashboard');

  const [numbers, users, config] = await Promise.all([
    whatsappAuthorizedNumberService.list(ctx),
    userService.list(ctx, { page: '1', pageSize: '100' }),
    whatsappAgentConfigService.get(ctx),
  ]);

  return (
    <WhatsappSettings
      numbers={numbers.map((row) => ({
        id: row.id,
        phone: row.phone,
        label: row.label,
        contactName: row.contactName,
        contactRole: row.contactRole,
        userId: row.userId,
        userName: row.user.name,
        userEmail: row.user.email,
        disabledAt: row.disabledAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      }))}
      users={users.items.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
      }))}
      config={{
        tone: config?.tone ?? '',
        instructions: config?.instructions ?? '',
        companyContext: config?.companyContext ?? '',
      }}
    />
  );
}
