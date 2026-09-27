import type { ReactNode } from 'react';

/** Titled section inside a tenant tab; keeps the existing mono uppercase h2 style. */
export function TabSection({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
