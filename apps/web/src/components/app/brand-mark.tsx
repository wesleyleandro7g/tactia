import { cn } from '@/lib/utils';

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Tactia"
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md bg-brand text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset]',
        className,
      )}
    >
      <span className="font-display text-lg italic leading-none">T</span>
    </span>
  );
}
