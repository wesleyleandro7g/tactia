import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Alert({
  className,
  tone = 'info',
  title,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children?: ReactNode;
}) {
  const tones = {
    info: 'border-info/30 bg-info-soft',
    success: 'border-success/30 bg-success-soft',
    warning: 'border-warning/30 bg-warning-soft',
    danger: 'border-danger/30 bg-danger-soft',
  };

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-md border px-3 py-2.5 text-sm', tones[tone], className)}
      {...props}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className={cn(title && 'mt-1', 'text-muted-foreground')}>{children}</div> : null}
    </div>
  );
}
