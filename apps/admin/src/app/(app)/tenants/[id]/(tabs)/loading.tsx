export default function TenantTabLoading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">Carregando seção…</span>
      <div aria-hidden="true" className="h-4 w-40 animate-pulse rounded-sm bg-muted" />
      <div aria-hidden="true" className="h-32 animate-pulse rounded-md border border-border bg-card" />
      <div aria-hidden="true" className="h-48 animate-pulse rounded-md border border-border bg-card" />
    </div>
  );
}
