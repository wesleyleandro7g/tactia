import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

const control =
  'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-subtle ' +
  'transition-colors hover:border-muted/60 disabled:cursor-not-allowed disabled:opacity-60';

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium text-fg', className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(control, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'resize-y', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(control, 'appearance-none pr-8', className)} {...props} />;
}

export type FieldProps = {
  /** Precisa casar com o `id` do controle para o label funcionar. */
  htmlFor: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
};

/**
 * Campo de formulário com label, dica e erro ligados por aria-describedby —
 * o erro é anunciado por leitor de tela sem depender da cor.
 */
export function Field({ htmlFor, label, hint, error, children, className }: FieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      <div aria-describedby={cn(hintId, errorId) || undefined}>{children}</div>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
