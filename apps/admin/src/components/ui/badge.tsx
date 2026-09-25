import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badge = cva(
  'inline-flex h-5 items-center rounded-sm border px-1.5 font-mono text-[10px] font-medium uppercase tracking-wide',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-muted-foreground',
        success: 'border-success/30 bg-success-soft text-success',
        warning: 'border-warning/30 bg-warning-soft text-warning',
        danger: 'border-danger/30 bg-danger-soft text-danger',
        info: 'border-info/30 bg-info-soft text-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badge>['tone']>;

export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}

const STATUS_TONES: Record<string, BadgeTone> = {
  active: 'success',
  completed: 'success',
  succeeded: 'success',
  partial: 'warning',
  needs_attention: 'warning',
  draft: 'neutral',
  paused: 'warning',
  suspended: 'warning',
  disabled: 'warning',
  running: 'info',
  pending: 'neutral',
  failed: 'danger',
  cancelled: 'neutral',
  deleted: 'danger',
};

export function statusTone(status: string): BadgeTone {
  return STATUS_TONES[status] ?? 'neutral';
}

export function severityTone(severity: string): BadgeTone {
  if (severity === 'critical' || severity === 'high') return 'danger';
  if (severity === 'medium') return 'warning';
  return 'neutral';
}
