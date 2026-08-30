import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const badge = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-border/60 text-muted',
        accent: 'bg-accent-soft text-accent',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
        info: 'bg-info-soft text-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badge>['tone']>;

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>;

/**
 * Badge sempre carrega texto: severidade e status nunca são comunicados
 * apenas por cor (WCAG 1.4.1).
 */
export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}

const SEVERITY_TONES: Record<string, BadgeTone> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
};

const STATUS_TONES: Record<string, BadgeTone> = {
  completed: 'success',
  approved: 'success',
  running: 'info',
  pending: 'neutral',
  awaiting_approval: 'warning',
  failed: 'danger',
  cancelled: 'neutral',
  rejected: 'danger',
  accepted: 'success',
  open: 'warning',
  acknowledged: 'info',
  resolved: 'success',
  dismissed: 'neutral',
};

export function severityTone(severity: string): BadgeTone {
  return SEVERITY_TONES[severity] ?? 'neutral';
}

export function statusTone(status: string): BadgeTone {
  return STATUS_TONES[status] ?? 'neutral';
}
