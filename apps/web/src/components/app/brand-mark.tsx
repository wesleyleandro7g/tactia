import Image from 'next/image';
import { cn } from '@/lib/utils';

const SYMBOL = '/tactia-symbol.svg';
const SYMBOL_SIZE = { width: 503, height: 496 } as const;

type BrandMarkProps = {
  className?: string;
  priority?: boolean;
};

export function BrandMark({ className, priority = false }: BrandMarkProps) {
  return (
    <span
      role="img"
      aria-label="Tactia"
      className={cn('inline-flex size-8 items-center justify-center', className)}
    >
      <Image
        src={SYMBOL}
        alt=""
        width={SYMBOL_SIZE.width}
        height={SYMBOL_SIZE.height}
        className="size-full"
        sizes="32px"
        priority={priority}
        unoptimized
      />
    </span>
  );
}
