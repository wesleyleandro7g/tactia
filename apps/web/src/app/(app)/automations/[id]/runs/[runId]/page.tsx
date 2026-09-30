import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/app/page-header';
import { AutomationScreen, automationLayout, type AutomationField } from '@/components/automations/automation-screen';
import { automationService } from '@/lib/automations';
import { hasAutomations } from '@/lib/automations-flag';
import { requireTenant } from '@/lib/server-context';
import { hasMinRole } from '@tactia/domain';

export const metadata = { title: 'Execução · Tactia' };

export default async function AutomationRunPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const ctx = await requireTenant('/automations');
  if (!(await hasAutomations(ctx.tenantId))) notFound();
  const { id, runId } = await params;
  let detail: Awaited<ReturnType<typeof automationService.get>>;
  try {
    detail = await automationService.get(ctx, id);
    await automationService.getRun(ctx, id, runId);
  } catch {
    notFound();
  }
  const fields = (detail.version?.inputSchema.fields ?? []) as AutomationField[];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={detail.automation.name} description="Execução compartilhável por URL." />
      <AutomationScreen
        automationId={id}
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
        focusRunId={runId}
        layout={automationLayout(detail.automation.componentKey)}
      />
    </div>
  );
}
