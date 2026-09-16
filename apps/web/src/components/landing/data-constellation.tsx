import type { ReactNode } from 'react';
import {
  Building2,
  Instagram,
  MessageCircle,
  Table,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function Sparkline({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 72 24" className={cn('h-5 w-14', className)} aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function SourceCard({
  className,
  delay,
  children,
}: {
  className?: string;
  delay?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-white/[0.09] bg-[#1a1918]/88 p-3 shadow-[0_20px_48px_rgba(0,0,0,0.45)] backdrop-blur-md',
        delay && 'motion-safe:animate-landing-float',
        className,
      )}
      style={delay ? { animationDelay: delay } : undefined}
    >
      {children}
    </div>
  );
}

function NodeGlow({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute size-2.5 rounded-full bg-[#fe7200] shadow-[0_0_14px_4px_rgba(254,114,0,0.75)]',
        className,
      )}
    />
  );
}

function VendasCard({ className, delay }: { className?: string; delay?: string }) {
  return (
    <SourceCard className={cn('relative w-[10.2rem]', className)} delay={delay}>
      <p className="text-[10px] text-[#a89f98]">Vendas</p>
      <p className="font-landing text-lg font-semibold text-white">R$ 57.535</p>
      <div className="mt-1 flex items-center justify-between text-[#3ecf8e]">
        <span className="text-[10px] font-medium">+12,6%</span>
        <Sparkline className="text-[#fe7200]" d="M1 16 C 12 14, 18 8, 28 10 S 48 4, 71 6" />
      </div>
      <NodeGlow className="top-1/2 -right-1" />
    </SourceCard>
  );
}

function CrmCard({ className, delay }: { className?: string; delay?: string }) {
  return (
    <SourceCard className={cn('relative w-[9.4rem]', className)} delay={delay}>
      <p className="flex items-center gap-1 text-[9px] font-semibold tracking-[0.12em] text-[#fe7200] uppercase">
        <Users className="size-3" /> CRM
      </p>
      <p className="mt-1 font-landing text-lg font-semibold text-white">378.893</p>
      <p className="text-[10px] text-[#a89f98]">clientes no período</p>
      <NodeGlow className="top-[60%] -right-1" />
    </SourceCard>
  );
}

function PlanilhaCard({ className, delay }: { className?: string; delay?: string }) {
  return (
    <SourceCard className={cn('relative w-[9.8rem]', className)} delay={delay}>
      <p className="flex items-center gap-1 text-[9px] font-semibold tracking-[0.12em] text-[#fe7200] uppercase">
        <Table className="size-3" /> Planilha
      </p>
      <div className="mt-2 overflow-hidden rounded-md border border-white/8">
        <div className="grid grid-cols-4 gap-px bg-[#fe7200]/80">
          {['SKU', 'Qtd', 'R$', '%'].map((h) => (
            <span key={h} className="bg-[#fe7200] px-1 py-0.5 text-center text-[7px] font-semibold text-white">
              {h}
            </span>
          ))}
        </div>
        {[0, 1, 2].map((row) => (
          <div key={row} className="grid grid-cols-4 gap-px bg-white/5">
            {Array.from({ length: 4 }, (_, col) => (
              <span key={col} className="bg-[#1a1918] px-1 py-0.5 text-center text-[7px] text-[#cfc6be]">
                {row * 4 + col + 12}
              </span>
            ))}
          </div>
        ))}
      </div>
      <NodeGlow className="top-1/2 -right-1" />
    </SourceCard>
  );
}

function WhatsAppCard({ className, delay }: { className?: string; delay?: string }) {
  return (
    <SourceCard className={cn('relative w-[8.6rem] !p-2.5', className)} delay={delay}>
      <p className="flex items-center gap-1 text-[9px] font-semibold tracking-[0.12em] text-[#25d366] uppercase">
        <MessageCircle className="size-3" /> WhatsApp
      </p>
      <div className="mt-2 space-y-1.5">
        <div className="ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-[#25d366]/20 px-2 py-1 text-[8px] leading-snug text-[#e8ffe8]">
          Pedido confirmado?
        </div>
        <div className="max-w-[90%] rounded-lg rounded-bl-sm bg-white/8 px-2 py-1 text-[8px] leading-snug text-[#f4efea]/80">
          Sim — enviamos agora.
        </div>
      </div>
      <NodeGlow className="top-[55%] -right-1" />
    </SourceCard>
  );
}

function InstagramCard({ className, delay }: { className?: string; delay?: string }) {
  return (
    <SourceCard className={cn('relative w-[8.4rem]', className)} delay={delay}>
      <p className="flex items-center gap-1 text-[9px] font-semibold tracking-[0.12em] text-[#fe7200] uppercase">
        <Instagram className="size-3" /> Instagram
      </p>
      <p className="mt-1 font-landing text-lg font-semibold text-white">12.4k</p>
      <p className="text-[10px] text-[#a89f98]">alcance no período</p>
      <NodeGlow className="top-[58%] -left-1" />
    </SourceCard>
  );
}

function NpsCard({ className, delay }: { className?: string; delay?: string }) {
  return (
    <SourceCard className={cn('relative w-[5.6rem] !p-2.5', className)} delay={delay}>
      <div className="relative mx-auto flex size-12 items-center justify-center">
        <svg viewBox="0 0 36 36" className="absolute inset-0 size-12 -rotate-90" aria-hidden="true">
          <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
          <circle
            cx="18"
            cy="18"
            r="14"
            fill="none"
            stroke="#fe7200"
            strokeWidth="3"
            strokeDasharray="64 88"
            strokeLinecap="round"
          />
        </svg>
        <span className="font-landing text-sm font-semibold text-white">36</span>
      </div>
      <p className="mt-1 text-center text-[8px] text-[#a89f98]">NPS</p>
      <NodeGlow className="-left-1 bottom-3" />
    </SourceCard>
  );
}

function CampanhasCard({ className, delay }: { className?: string; delay?: string }) {
  return (
    <SourceCard className={cn('relative w-[8.8rem]', className)} delay={delay}>
      <div className="flex items-end gap-1">
        {[40, 62, 48, 78, 55, 88, 70].map((h, i) => (
          <span
            key={i}
            className="w-2 rounded-sm bg-[#fe7200]/85"
            style={{ height: `${h * 0.28}px`, opacity: 0.45 + (i % 4) * 0.15 }}
          />
        ))}
      </div>
      <p className="mt-2 text-[10px] text-[#a89f98]">Campanhas</p>
      <p className="font-landing text-sm font-semibold text-white">+18,0%</p>
      <NodeGlow className="top-1/2 -left-1" />
    </SourceCard>
  );
}

function ErpCard({ className, delay }: { className?: string; delay?: string }) {
  return (
    <SourceCard className={cn('relative w-[8.2rem]', className)} delay={delay}>
      <p className="flex items-center gap-1 text-[9px] font-semibold tracking-[0.12em] text-[#fe7200] uppercase">
        <Building2 className="size-3" /> ERP
      </p>
      <p className="mt-1 font-landing text-lg font-semibold text-white">R$ 236</p>
      <p className="text-[10px] text-[#a89f98]">ticket operacional</p>
      <NodeGlow className="top-1/2 -left-1" />
    </SourceCard>
  );
}

/** Fontes de dados reunidas em constelação — seção própria da landing. */
export function DataConstellation() {
  return (
    <section className="relative isolate w-full overflow-hidden px-5 py-20 sm:px-8">
      <div className="mx-auto max-w-6xl text-center">
        <p className="text-sm font-medium tracking-[0.18em] text-[#fe7200] uppercase">Suas fontes</p>
        <h2 className="mx-auto mt-3 max-w-2xl font-landing text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
          Dados espalhados, uma visão só.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
          CRM, ERP, planilhas, WhatsApp e redes sociais entram no mesmo tecido — prontos para a Ta ler e agir.
        </p>
      </div>

      <div className="mx-auto mt-10 grid max-w-4xl grid-cols-2 justify-items-center gap-4 sm:grid-cols-3 lg:hidden">
        <VendasCard />
        <CrmCard />
        <PlanilhaCard />
        <WhatsAppCard />
        <InstagramCard />
        <NpsCard />
        <CampanhasCard />
        <ErpCard />
      </div>

      <div className="relative mx-auto mt-12 hidden h-[min(38rem,72svh)] w-full max-w-6xl lg:block">
        <div className="pointer-events-none absolute inset-0 rounded-[2rem] bg-[radial-gradient(ellipse_at_center,rgba(254,114,0,0.12),transparent_68%)]" />
        <VendasCard className="absolute top-[8%] left-[4%] xl:left-[8%]" delay="0s" />
        <CrmCard className="absolute top-[36%] left-[2%] xl:left-[5%]" delay="0.35s" />
        <PlanilhaCard className="absolute top-[58%] left-[6%] xl:left-[10%]" delay="0.7s" />
        <WhatsAppCard className="absolute bottom-[6%] left-[22%] xl:left-[26%]" delay="1s" />
        <InstagramCard className="absolute top-[8%] right-[4%] xl:right-[8%]" delay="1.65s" />
        <NpsCard className="absolute top-[30%] right-[2%] xl:right-[5%]" delay="0.55s" />
        <CampanhasCard className="absolute top-[52%] right-[8%] xl:right-[12%]" delay="1.35s" />
        <ErpCard className="absolute bottom-[6%] right-[20%] xl:right-[24%]" delay="2s" />
      </div>
    </section>
  );
}
