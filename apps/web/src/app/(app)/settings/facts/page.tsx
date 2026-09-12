import { FactsSettings } from '@/components/app/facts-settings';
import { requireTenant } from '@/lib/server-context';
import { businessFactService } from '@/lib/services';

export const metadata = { title: 'Fatos do negócio · Tactia' };

export default async function FactsSettingsPage() {
  const ctx = await requireTenant('/settings/facts');
  const { items } = await businessFactService.listActive(ctx);
  return (
    <FactsSettings
      facts={items.map((fact) => ({
        id: fact.id,
        kind: fact.kind,
        text: fact.text,
        source: fact.source,
        validFrom: fact.validFrom?.toISOString() ?? null,
        validTo: fact.validTo?.toISOString() ?? null,
      }))}
    />
  );
}
