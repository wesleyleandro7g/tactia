import Link from 'next/link';
import { BrandLogo } from '@/components/app/brand-logo';
import { ThemeToggle } from '@/components/app/theme-toggle';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { LandingCta } from '@/components/landing/landing-cta';

export function LandingNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-border/40 bg-background/75 backdrop-blur-md">
      <div className="mx-auto flex h-[4.25rem] w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" className="inline-flex shrink-0" aria-label="Tactia, página inicial">
          <BrandLogo className="h-7 sm:h-9" priority />
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className={cn(buttonVariants({ variant: 'ghost', size: 'md' }), 'h-10 px-3 text-sm')}
          >
            Entrar
          </Link>
          <LandingCta href="/signup" className="h-10 px-4 text-sm sm:px-5">
            Comece agora
          </LandingCta>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
