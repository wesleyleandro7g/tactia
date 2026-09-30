import { notFound } from 'next/navigation';
import { AutomationsPanel } from '@/components/app/automations-panel';
import { TabSection } from '@/components/app/tab-section';
import { automationService } from '@/lib/automations';
import { loadOperator } from '@/lib/tenant-loaders';
import { operatorTenantContext } from '@/lib/operator-tenant';
import { prisma } from '@tactia/database';

export const metadata = { title: 'Automações · Empresa · Tactia Ops' };

export default async function TenantAutomationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await loadOperator(id);
  const tenant = await prisma.tenant.findFirst({ where: { id, status: { not: 'deleted' } }, select: { automationsEnabled: true } });
  if (!tenant) notFound();
  const scoped = operatorTenantContext(ctx, id);
  const page = await automationService.list(scoped);
  const items = await Promise.all(
    page.items.map(async (item) => {
      const detail = await automationService.get(scoped, item.id);
      const version = detail.version;
      return {
        id: item.id,
        name: item.name,
        purpose: item.purpose,
        status: item.status,
        versionId: version?.id ?? null,
        definitionJson: version
          ? JSON.stringify(
              {
                name: detail.automation.name,
                purpose: detail.automation.purpose,
                inputSchema: version.inputSchema,
                outputSchema: version.outputSchema,
                steps: version.steps,
                pageConfig: version.pageConfig,
                authorizationPolicy: version.authorizationPolicy,
              },
              null,
              2,
            )
          : '',
        fields: (version?.inputSchema.fields ?? []).map((field) => ({
          key: field.key,
          label: field.label,
          released: field.released === true,
        })),
        defaults: detail.automation.parameterDefaults,
        triggers: detail.triggers,
      };
    }),
  );

  return (
    <TabSection title="Automações">
      <p className="text-sm text-muted-foreground">
        Crie um rascunho a partir de um modelo ou de uma definição estruturada, edite, publique, pause e teste.
        A execução usa os workers do app.
      </p>
      <AutomationsPanel tenantId={id} enabled={tenant.automationsEnabled} items={items} />
    </TabSection>
  );
}
