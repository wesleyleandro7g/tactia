import { prisma } from '@tactia/database';
import { OnboardingWizard, type OnboardingState } from '@/components/app/onboarding-wizard';
import { getServerContext, listUserTenants } from '@/lib/server-context';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Configurar dados · Tactia' };

/**
 * Onboarding (spec §55). O estado inicial é lido do banco para que recarregar a
 * página retome o wizard no passo real — não em um rascunho do cliente.
 */
export default async function OnboardingPage() {
  const ctx = await getServerContext();
  if (!ctx.userId) redirect('/login?returnTo=%2Fonboarding');

  const tenants = await listUserTenants(ctx);
  const tenantId = ctx.tenantId;

  if (!tenantId) {
    return (
      <OnboardingWizard
        initial={{
          hasTenant: false,
          tenantName: null,
          dataSource: null,
          mappingCount: 0,
          lastSyncJob: null,
          summary: { customers: 0, sales: 0, sellers: 0, products: 0, revenue: 0 },
        }}
      />
    );
  }

  const [dataSource, mappingCount, syncJob, customers, sales, sellers, products, revenue] =
    await Promise.all([
      prisma.dataSource.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, type: true },
      }),
      prisma.mapping.count({ where: { tenantId, active: true } }),
      prisma.syncJob.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          recordsRead: true,
          recordsCreated: true,
          recordsUpdated: true,
          recordsFailed: true,
          error: true,
        },
      }),
      prisma.customer.count({ where: { tenantId, deletedAt: null } }),
      prisma.sale.count({ where: { tenantId } }),
      prisma.seller.count({ where: { tenantId, deletedAt: null } }),
      prisma.product.count({ where: { tenantId, deletedAt: null } }),
      prisma.sale.aggregate({
        where: { tenantId, status: 'confirmed' },
        _sum: { totalAmount: true },
      }),
    ]);

  const initial: OnboardingState = {
    hasTenant: true,
    tenantName: tenants.find((tenant) => tenant.id === tenantId)?.name ?? 'Minha empresa',
    dataSource: dataSource
      ? { id: dataSource.id, name: dataSource.name, type: dataSource.type }
      : null,
    mappingCount,
    lastSyncJob: syncJob,
    summary: {
      customers,
      sales,
      sellers,
      products,
      revenue: Number(revenue._sum.totalAmount ?? 0),
    },
  };

  return <OnboardingWizard initial={initial} />;
}
