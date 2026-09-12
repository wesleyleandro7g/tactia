import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton as ShadcnSkeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';

export function Skeleton({ className }: { className?: string }) {
  return <ShadcnSkeleton aria-hidden="true" className={className} />;
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
    <Empty className={cn('border border-dashed border-border px-6 py-10', className)}>
      <EmptyHeader>
        <EmptyTitle className="text-base font-medium">{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
