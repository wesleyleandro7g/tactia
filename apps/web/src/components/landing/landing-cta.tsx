import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type LandingCtaProps = {
  href: string;
  children: ReactNode;
  className?: string;
};

export function LandingCta({ href, children, className }: LandingCtaProps) {
  return (
    <Link
      href={href}
      className={cn(
        buttonVariants({ variant: 'default', size: 'md' }),
        'h-12 gap-2 rounded-full px-7 text-[0.95rem] font-semibold shadow-[0_10px_36px_rgba(254,114,0,0.42)] hover:opacity-95',
        className,
      )}
    >
      {children}
      <ArrowRight className="size-4" aria-hidden="true" />
    </Link>
  );
}
