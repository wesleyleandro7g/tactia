import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Input as ShadcnInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea as ShadcnTextarea } from '@/components/ui/textarea';

export { Input } from '@/components/ui/input';
export { Textarea } from '@/components/ui/textarea';
export { Label } from '@/components/ui/label';
export {
  Field as ShadcnField,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from '@/components/ui/shadcn-field';

const control =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors hover:border-muted-foreground/40 disabled:cursor-not-allowed disabled:opacity-60';

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(control, 'appearance-none pr-8', className)} {...props} />;
}

export type FieldProps = {
  htmlFor: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
};

/**
 * Campo de formulário com label, dica e erro ligados por aria-describedby.
 */
export function Field({ htmlFor, label, hint, error, children, className }: FieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <div aria-describedby={cn(hintId, errorId) || undefined}>{children}</div>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Input com estilo legado para formulários existentes. */
export function FormInput({ className, ...props }: ComponentProps<'input'>) {
  return <ShadcnInput className={cn('h-10', className)} {...props} />;
}

/** Textarea com estilo legado para formulários existentes. */
export function FormTextarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <ShadcnTextarea className={cn('resize-y', className)} {...props} />;
}
