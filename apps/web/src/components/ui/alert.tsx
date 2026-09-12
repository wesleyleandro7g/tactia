import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const alert = cva('rounded-lg border px-4 py-3 text-sm', {
  variants: {
    tone: {
      info: 'border-info/30 bg-info-soft text-foreground',
      success: 'border-success/30 bg-success-soft text-foreground',
      warning: 'border-warning/30 bg-warning-soft text-foreground',
      danger: 'border-danger/30 bg-danger-soft text-foreground',
    },
  },
  defaultVariants: { tone: 'info' },
});

export type AlertProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof alert> & {
    title?: string;
    children?: ReactNode;
  };

/**
 * Mensagem de estado. `danger` usa role="alert" para ser anunciada de imediato;
 * os outros tons usam status (polite).
 */
export function Alert({ className, tone = 'info', title, children, ...props }: AlertProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(alert({ tone }), className)}
      {...props}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? (
        <div className={cn(title && 'mt-1', 'text-muted-foreground')}>{children}</div>
      ) : null}
    </div>
  );
}

export { alert as alertVariants };
