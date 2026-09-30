'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
import { AVAILABILITY_LABEL, type TodaySnapshot } from '@/components/app/command-center/types';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

function availabilityTone(availability: TodaySnapshot['availability']) {
  if (availability === 'ready') return 'success' as const;
  if (availability === 'error') return 'danger' as const;
  return 'warning' as const;
}

function overlayDescription(snapshot: TodaySnapshot) {
  const attention = snapshot.attention ?? 'Nenhuma decisão necessária agora';
  const freshness = snapshot.updatedAt ? `dados até ${snapshot.updatedAt}` : 'atualização não disponível';
  return `${snapshot.periodLabel} · ${freshness}. ${attention}`;
}

function TodaySummary({
  snapshot,
  attention,
}: {
  snapshot: TodaySnapshot;
  attention: string;
}) {
  return (
    <>
      <span className="shrink-0 font-display text-sm italic text-foreground">Hoje</span>
      <Badge tone={availabilityTone(snapshot.availability)}>
        {AVAILABILITY_LABEL[snapshot.availability]}
      </Badge>
      <span className="min-w-0 flex-1 truncate font-display text-sm italic text-foreground">
        {attention}
      </span>
      {snapshot.updatedAt ? (
        <span className="hidden shrink-0 tabular text-xs text-muted-foreground lg:inline">
          {snapshot.updatedAt}
        </span>
      ) : null}
    </>
  );
}

export function TodayChrome({
  snapshot,
  children,
}: {
  snapshot: TodaySnapshot;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const attention = snapshot.attention ?? 'Nada a decidir';
  const open = openPath === pathname;

  const briefing = (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      {children}
    </div>
  );

  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpenPath(pathname)}
        className={cn(
          'flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left transition-[border-color,background-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-primary/30 hover:bg-card-hover',
          open && 'border-primary/40',
        )}
      >
        <TodaySummary snapshot={snapshot} attention={attention} />
      </button>
      <Link
        href={snapshot.chatHref}
        aria-label="Conversar sobre o foco"
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon-lg' }), 'min-h-11 min-w-11 shrink-0')}
      >
        <MessageSquare />
      </Link>

      {isMobile ? (
        <Sheet open={open} onOpenChange={(next) => setOpenPath(next ? pathname : null)}>
          <SheetContent
            side="bottom"
            className="h-[90dvh] max-h-[90dvh] gap-0 rounded-t-2xl border-border bg-card p-0"
          >
            <div className="flex justify-center pt-2" aria-hidden="true">
              <span className="h-1 w-10 rounded-full bg-border" />
            </div>
            <SheetHeader className="border-b border-border px-6 py-3 pr-14">
              <SheetTitle className="font-display text-2xl tracking-tight">Hoje</SheetTitle>
              <SheetDescription>{overlayDescription(snapshot)}</SheetDescription>
            </SheetHeader>
            {briefing}
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={(next) => setOpenPath(next ? pathname : null)}>
          <DialogContent
            className="p-0"
            finalFocus={triggerRef}
          >
            <DialogHeader>
              <DialogTitle>Hoje</DialogTitle>
              <DialogDescription>{overlayDescription(snapshot)}</DialogDescription>
            </DialogHeader>
            {briefing}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
