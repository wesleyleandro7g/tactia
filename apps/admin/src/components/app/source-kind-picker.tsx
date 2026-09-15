import Link from 'next/link';
import { groupSelectableSourceKinds } from '@tactia/domain/data-sources/catalog';

export function SourceKindPicker({ tenantId }: { tenantId: string }) {
  const groups = groupSelectableSourceKinds();

  return (
    <section className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.group} className="flex flex-col gap-2">
          <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
            {group.groupLabel}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {group.kinds.map((item) => (
              <Link
                key={item.id}
                href={`/tenants/${tenantId}/data-sources/new/${item.id}`}
                className="rounded-md border border-border bg-card px-3 py-3 text-left hover:border-muted-foreground/40"
              >
                <span className="block font-mono text-sm text-foreground">{item.label}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{item.description}</span>
                {item.connector === 'none' ? (
                  <span className="mt-2 block font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    Sem conector
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
