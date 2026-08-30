import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-border/50', className)}
    />
  );
}

/** Placeholder de card enquanto o RSC resolve os dados. */
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-32" />
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className="mt-2 h-3 w-full" />
      ))}
      <span className="sr-only">Carregando…</span>
    </div>
  );
}

export type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center',
        className,
      )}
    >
      <p className="font-medium">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
