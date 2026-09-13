import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  className,
  compact = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <header className={cn('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        <h1
          className={cn(
            'font-display tracking-tight text-foreground',
            compact ? 'text-2xl' : 'text-3xl',
          )}
        >
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
