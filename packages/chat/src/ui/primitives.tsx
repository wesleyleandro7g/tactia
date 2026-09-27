'use client';

import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { cn } from './cn';

/**
 * UI primitives used by the shared chat. They only rely on semantic design
 * tokens (primary, muted, card, danger-soft…), so each app keeps its own theme.
 * `bg-brand` and `--brand-foreground` are provided by the host stylesheet.
 */

export function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <Loader2
      data-slot="spinner"
      role="status"
      aria-label="Carregando"
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  );
}

const buttonVariants = cva(
  'group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[opacity,transform,background-color,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        default:
          'bg-brand text-[var(--brand-foreground,#fff)] shadow-[0_1px_0_rgba(255,255,255,0.18)_inset] hover:opacity-90',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground',
        secondary:
          'border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-muted hover:text-foreground',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20',
        success:
          'bg-success-soft text-success hover:bg-success/20 focus-visible:border-success/40 focus-visible:ring-success/20',
      },
      size: {
        default: 'h-8 gap-1.5 px-2.5',
        sm: 'h-7 gap-1 rounded-md px-2.5 text-[0.8rem] [&_svg:not([class*="size-"])]:size-3.5',
        icon: 'size-8',
        'icon-sm': 'size-7 rounded-md',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { loading?: boolean };

export function Button({
  className,
  variant,
  size,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner className="size-3.5" /> : null}
      {children}
    </ButtonPrimitive>
  );
}

const badgeVariants = cva(
  'inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-border/60 text-muted-foreground',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

/** Badges always carry text: status is never conveyed by color alone (WCAG 1.4.1). */
export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

const alertVariants = cva('rounded-lg border px-4 py-3 text-sm', {
  variants: {
    tone: {
      info: 'border-info/30 bg-info-soft text-foreground',
      warning: 'border-warning/30 bg-warning-soft text-foreground',
      danger: 'border-danger/30 bg-danger-soft text-foreground',
    },
  },
  defaultVariants: { tone: 'info' },
});

/** `danger` is announced immediately (role=alert); other tones are polite. */
export function Alert({
  className,
  tone = 'info',
  title,
  children,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> &
  VariantProps<typeof alertVariants> & { title?: string; children?: React.ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? (
        <div className={cn(title && 'mt-1', 'text-muted-foreground')}>{children}</div>
      ) : null}
    </div>
  );
}

export function Collapsible(props: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

export function CollapsibleTrigger(props: CollapsiblePrimitive.Trigger.Props) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

export function CollapsibleContent(props: CollapsiblePrimitive.Panel.Props) {
  return <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
