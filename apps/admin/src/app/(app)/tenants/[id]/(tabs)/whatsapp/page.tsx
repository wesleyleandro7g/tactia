import { notFound } from 'next/navigation';
import { WhatsappSettings } from '@/components/app/whatsapp-settings';
import { TabSection } from '@/components/app/tab-section';
import { listTenantWhatsappNumbers } from '@/lib/tenant-whatsapp';
import { loadOperator } from '@/lib/tenant-loaders';
import { ErrorCode, isAppError } from '@tactia/shared';

export const metadata = { title: 'WhatsApp · Empresa · Tactia Ops' };

export default async function TenantWhatsappPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await loadOperator(id);

  let numbers: Awaited<ReturnType<typeof listTenantWhatsappNumbers>>['numbers'];
  let users: Awaited<ReturnType<typeof listTenantWhatsappNumbers>>['users'];
  try {
    ({ numbers, users } = await listTenantWhatsappNumbers(ctx, id));
  } catch (error) {
    if (isAppError(error) && error.code === ErrorCode.NOT_FOUND) notFound();
    throw error;
  }

  return (
    <TabSection title="WhatsApp">
      <p className="text-sm text-muted-foreground">
        Números autorizados a falar com o assistente da Tactia no WhatsApp. Cada número fica ligado
        a um usuário desta empresa e usa o mesmo contexto do chat.
      </p>
      <WhatsappSettings
        apiBasePath={`/api/v1/tenants/${id}/whatsapp`}
        users={users}
        numbers={numbers.map((row) => ({
          id: row.id,
          phone: row.phone,
          label: row.label,
          userId: row.userId,
          userName: row.user.name,
          userEmail: row.user.email,
          disabledAt: row.disabledAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        }))}
      />
    </TabSection>
  );
}
