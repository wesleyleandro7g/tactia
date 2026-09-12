import Image from 'next/image';
import { cn } from '@/lib/utils';

const LOGO_LIGHT = '/tactia-logo-black.svg';
const LOGO_DARK = '/tactia-logo-white.svg';
const WORDMARK = { width: 1600, height: 443 } as const;

type BrandLogoProps = {
  className?: string;
  priority?: boolean;
};

export function BrandLogo({ className, priority = false }: BrandLogoProps) {
  return (
    <span
      role="img"
      aria-label="Tactia"
      className={cn('inline-flex h-8 max-w-full items-center', className)}
    >
      <Image
        src={LOGO_LIGHT}
        alt=""
        width={WORDMARK.width}
        height={WORDMARK.height}
        className="h-full w-auto max-w-full dark:hidden"
        sizes="200px"
        priority={priority}
        unoptimized
      />
      <Image
        src={LOGO_DARK}
        alt=""
        width={WORDMARK.width}
        height={WORDMARK.height}
        className="hidden h-full w-auto max-w-full dark:block"
        sizes="200px"
        priority={priority}
        unoptimized
      />
    </span>
  );
}
