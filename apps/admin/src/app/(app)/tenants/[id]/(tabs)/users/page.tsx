import { AddUserForm, MembershipControls, ResetPasswordButton } from '@/components/app/tenant-actions';
import { TabSection } from '@/components/app/tab-section';
import { DataTable } from '@/components/ui/data-table';
import { loadTenantHeader, loadTenantUsers } from '@/lib/tenant-loaders';

export const metadata = { title: 'Usuários · Empresa · Tactia Ops' };

export default async function TenantUsersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ tenant }, users] = await Promise.all([loadTenantHeader(id), loadTenantUsers(id)]);

  return (
    <TabSection title="Usuários">
      <AddUserForm tenantId={tenant.id} />
      <DataTable
        caption={`Usuários de ${tenant.name}`}
        columns={[
          { key: 'name', header: 'Nome', render: (row: (typeof users)[number]) => row.user.name },
          { key: 'email', header: 'E-mail', render: (row) => row.user.email },
          {
            key: 'role',
            header: 'Papel / status',
            render: (row) => (
              <MembershipControls
                tenantId={tenant.id}
                membershipId={row.id}
                role={row.role}
                status={row.status}
              />
            ),
          },
          {
            key: 'password',
            header: 'Senha',
            render: (row) => <ResetPasswordButton tenantId={tenant.id} userId={row.userId} />,
          },
        ]}
        rows={users}
        rowKey={(row) => row.id}
        emptyLabel="Nenhum usuário."
      />
    </TabSection>
  );
}
