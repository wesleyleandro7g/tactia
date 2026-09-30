import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/app/page-header';
import { AutomationScreen, automationLayout, type AutomationField } from '@/components/automations/automation-screen';
import { automationService } from '@/lib/automations';
import { hasAutomations } from '@/lib/automations-flag';
import { requireTenant } from '@/lib/server-context';
import { hasMinRole } from '@tactia/domain';

export const metadata = { title: 'Automação · Tactia' };

export default async function AutomationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ layout?: string }>;
}) {
  const ctx = await requireTenant('/automations');
  if (!(await hasAutomations(ctx.tenantId))) notFound();
  const { id } = await params;
  const query = await searchParams;
  let detail: Awaited<ReturnType<typeof automationService.get>>;
  try {
    detail = await automationService.get(ctx, id);
  } catch {
    notFound();
  }
  const fields = (detail.version?.inputSchema.fields ?? []) as AutomationField[];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={detail.automation.name} description={detail.automation.purpose} />
      <AutomationScreen
        automationId={detail.automation.id}
        name={detail.automation.name}
        purpose={detail.automation.purpose}
        status={detail.automation.status}
        componentKey={detail.automation.componentKey}
        fields={fields}
        defaults={detail.automation.parameterDefaults}
        canExecute={Boolean(ctx.role && hasMinRole(ctx.role, 'member'))}
        canReconcile={Boolean(ctx.role && hasMinRole(ctx.role, 'admin'))}
        blocks={detail.version?.pageConfig.blocks ?? []}
        runs={detail.runs}
        layout={automationLayout(detail.automation.componentKey, query.layout)}
      />
    </div>
  );
}
