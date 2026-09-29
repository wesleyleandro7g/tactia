import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Field({
  htmlFor,
  label,
  hint,
  error,
  children,
  className,
}: {
  htmlFor: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </label>
      {hint ? <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
