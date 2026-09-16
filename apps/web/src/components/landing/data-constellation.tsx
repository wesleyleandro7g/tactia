'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import {
  Building2,
  FileText,
  Instagram,
  LayoutDashboard,
  MessageCircle,
  MessageSquare,
  Table,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const MOCK_NAV = [
  { label: 'Dashboard', icon: LayoutDashboard, active: true },
  { label: 'Briefings', icon: FileText, active: false },
  { label: 'Chat', icon: MessageSquare, active: false },
] as const;

const MOCK_METRICS = [
  { label: 'Receita', value: 'R$ 57.535', delta: '+12,6%' },
  { label: 'Clientes', value: '378.893', delta: '+4,1%' },
  { label: 'Ticket', value: 'R$ 236', delta: '+2,8%' },
  { label: 'Alcance', value: '12.4k', delta: '+18,0%' },
] as const;

const LINK_MOTION = [
  { id: 'vendas', delay: '0s', duration: '1.05s', packet: '0.85s' },
  { id: 'crm', delay: '0.12s', duration: '1.15s', packet: '0.92s' },
  { id: 'planilha', delay: '0.22s', duration: '1.1s', packet: '0.88s' },
  { id: 'whatsapp', delay: '0.32s', duration: '1.2s', packet: '0.95s' },
  { id: 'instagram', delay: '0.08s', duration: '1.08s', packet: '0.86s' },
  { id: 'nps', delay: '0.16s', duration: '1.12s', packet: '0.9s' },
  { id: 'campanhas', delay: '0.28s', duration: '1.22s', packet: '0.98s' },
  { id: 'erp', delay: '0.38s', duration: '1.18s', packet: '0.94s' },
] as const;

type ConstellationLink = (typeof LINK_MOTION)[number] & { d: string };

function cubicLink(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const c1x = x1 + dx * 0.42;
  const c1y = y1 + dy * 0.08;
  const c2x = x1 + dx * 0.62;
  const c2y = y2 - dy * 0.1;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function Sparkline({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 72 24" className={cn('h-5 w-14', className)} aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function SourceCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'z-10 rounded-2xl border border-white/[0.09] bg-[#1a1918]/88 p-3 shadow-[0_20px_48px_rgba(0,0,0,0.45)] backdrop-blur-md',
        className,
      )}
    >
      {children}
    </div>
  );
}

function NodeGlow({
  className,
  node,
  port,
}: {
  className?: string;
  node?: string;
  port?: string;
}) {
  return (
    <span
      data-constellation-node={node}
      data-constellation-port={port}
      className={cn(
        'pointer-events-none absolute size-2.5 rounded-full bg-[#fe7200] shadow-[0_0_14px_4px_rgba(254,114,0,0.75)]',
        className,
      )}
    />
  );
}

function VendasCard({ className }: { className?: string }) {
  return (
    <SourceCard className={cn('relative w-[10.2rem]', className)}>
      <p className="text-[10px] text-[#a89f98]">Vendas</p>
      <p className="font-landing text-lg font-semibold text-white">R$ 57.535</p>
      <div className="mt-1 flex items-center justify-between text-[#3ecf8e]">
        <span className="text-[10px] font-medium">+12,6%</span>
        <Sparkline className="text-[#fe7200]" d="M1 16 C 12 14, 18 8, 28 10 S 48 4, 71 6" />
      </div>
      <NodeGlow className="top-1/2 -right-1" node="vendas" />
    </SourceCard>
  );
}

function CrmCard({ className }: { className?: string }) {
  return (
    <SourceCard className={cn('relative w-[9.4rem]', className)}>
      <p className="flex items-center gap-1 text-[9px] font-semibold tracking-[0.12em] text-[#fe7200] uppercase">
        <Users className="size-3" /> CRM
      </p>
      <p className="mt-1 font-landing text-lg font-semibold text-white">378.893</p>
      <p className="text-[10px] text-[#a89f98]">clientes no período</p>
      <NodeGlow className="top-[60%] -right-1" node="crm" />
    </SourceCard>
  );
}

function PlanilhaCard({ className }: { className?: string }) {
  return (
    <SourceCard className={cn('relative w-[9.8rem]', className)}>
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
      <NodeGlow className="top-1/2 -right-1" node="planilha" />
    </SourceCard>
  );
}

function WhatsAppCard({ className }: { className?: string }) {
  return (
    <SourceCard className={cn('relative w-[8.6rem] !p-2.5', className)}>
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
      <NodeGlow className="top-[55%] -right-1" node="whatsapp" />
    </SourceCard>
  );
}

function InstagramCard({ className }: { className?: string }) {
  return (
    <SourceCard className={cn('relative w-[8.4rem]', className)}>
      <p className="flex items-center gap-1 text-[9px] font-semibold tracking-[0.12em] text-[#fe7200] uppercase">
        <Instagram className="size-3" /> Instagram
      </p>
      <p className="mt-1 font-landing text-lg font-semibold text-white">12.4k</p>
      <p className="text-[10px] text-[#a89f98]">alcance no período</p>
      <NodeGlow className="top-[58%] -left-1" node="instagram" />
    </SourceCard>
  );
}

function NpsCard({ className }: { className?: string }) {
  return (
    <SourceCard className={cn('relative w-[5.6rem] !p-2.5', className)}>
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
      <NodeGlow className="-left-1 bottom-3" node="nps" />
    </SourceCard>
  );
}

function CampanhasCard({ className }: { className?: string }) {
  return (
    <SourceCard className={cn('relative w-[8.8rem]', className)}>
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
      <NodeGlow className="top-1/2 -left-1" node="campanhas" />
    </SourceCard>
  );
}

function ErpCard({ className }: { className?: string }) {
  return (
    <SourceCard className={cn('relative w-[8.2rem]', className)}>
      <p className="flex items-center gap-1 text-[9px] font-semibold tracking-[0.12em] text-[#fe7200] uppercase">
        <Building2 className="size-3" /> ERP
      </p>
      <p className="mt-1 font-landing text-lg font-semibold text-white">R$ 236</p>
      <p className="text-[10px] text-[#a89f98]">ticket operacional</p>
      <NodeGlow className="top-1/2 -left-1" node="erp" />
    </SourceCard>
  );
}

function ConstellationLinks({ links }: { links: ConstellationLink[] }) {
  if (links.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[1] h-full w-full overflow-visible"
      viewBox="0 0 1000 600"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <filter id="constellation-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {links.map((link) => (
        <g key={link.id} filter="url(#constellation-glow)">
          <path d={link.d} fill="none" stroke="rgba(254,114,0,0.38)" strokeWidth="1.5" />
          <path
            d={link.d}
            fill="none"
            stroke="#fe7200"
            strokeWidth="1.55"
            strokeLinecap="round"
            strokeDasharray="7 16"
            className="motion-safe:animate-landing-flow"
            style={{ animationDelay: link.delay, animationDuration: link.duration }}
          />
          <path
            d={link.d}
            fill="none"
            stroke="#fff4e8"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeDasharray="14 78"
            className="motion-safe:animate-landing-flow"
            style={{
              animationDelay: link.delay,
              animationDuration: link.packet,
            }}
          />
        </g>
      ))}
    </svg>
  );
}

function PlatformMock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-constellation-hub="true"
      className={cn(
        'relative overflow-hidden rounded-[1.25rem] border border-white/12 bg-[#0f0e0d] p-1.5 shadow-[0_28px_80px_rgba(254,114,0,0.22)]',
        className,
      )}
    >
      <NodeGlow className="top-[18%] -left-1" port="vendas" />
      <NodeGlow className="top-[48%] -left-1" port="crm" />
      <NodeGlow className="top-[72%] -left-1" port="planilha" />
      <NodeGlow className="bottom-[6%] left-[18%]" port="whatsapp" />
      <NodeGlow className="top-[18%] -right-1" port="instagram" />
      <NodeGlow className="top-[42%] -right-1" port="nps" />
      <NodeGlow className="top-[62%] -right-1" port="campanhas" />
      <NodeGlow className="bottom-[6%] right-[18%]" port="erp" />
      <div className="overflow-hidden rounded-[0.95rem] border border-white/6 bg-[#161514]">
        <div className="flex min-h-[16.5rem]">
          <div className="hidden w-[7.6rem] shrink-0 border-r border-white/8 bg-[#121110] p-2 sm:block">
            <div className="mb-3 flex items-center gap-1.5 px-1">
              <Image src="/tactia-symbol.svg" alt="" width={14} height={14} className="size-3.5" unoptimized />
              <span className="font-landing text-[11px] font-semibold text-[#f4efea]">Tactia</span>
            </div>
            <ul className="space-y-0.5">
              {MOCK_NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <li
                    key={item.label}
                    className={
                      item.active
                        ? 'flex items-center gap-1.5 rounded-md bg-[#fe7200]/18 px-1.5 py-1.5 text-[9px] font-medium text-[#fe7200]'
                        : 'flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[9px] text-[#a89f98]'
                    }
                  >
                    <Icon className="size-3" />
                    {item.label}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="flex min-w-0 flex-1 flex-col px-3 py-3">
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="font-landing text-[15px] font-semibold tracking-tight text-[#f4efea]">Dashboard</p>
                <p className="text-[8px] text-[#a89f98]">Visão unificada · mês atual</p>
              </div>
              <span className="rounded-full bg-[#fe7200]/16 px-2 py-0.5 text-[8px] font-medium text-[#fe7200]">
                ao vivo
              </span>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-1.5">
              {MOCK_METRICS.map((metric) => (
                <div key={metric.label} className="rounded-lg border border-white/8 bg-white/[0.035] px-2 py-1.5">
                  <p className="text-[8px] text-[#a89f98]">{metric.label}</p>
                  <p className="font-landing text-[12px] font-semibold text-[#f4efea]">{metric.value}</p>
                  <p className="text-[8px] font-medium text-[#3ecf8e]">{metric.delta}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 rounded-lg border border-white/8 bg-white/[0.035] px-2 py-1.5">
              <p className="text-[8px] text-[#a89f98]">Receita no tempo</p>
              <svg viewBox="0 0 160 28" className="mt-1 h-6 w-full" aria-hidden="true">
                <path
                  d="M0 22 C 18 20, 32 16, 48 14 S 80 12, 96 8 S 130 7, 160 3"
                  fill="none"
                  stroke="#fe7200"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function measureLinks(root: HTMLElement): ConstellationLink[] {
  const rootBox = root.getBoundingClientRect();
  if (rootBox.width < 8 || rootBox.height < 8) return [];

  const toLocal = (x: number, y: number) => ({
    x: ((x - rootBox.left) / rootBox.width) * 1000,
    y: ((y - rootBox.top) / rootBox.height) * 600,
  });

  return LINK_MOTION.flatMap((meta) => {
    const node = root.querySelector<HTMLElement>(`[data-constellation-node="${meta.id}"]`);
    const port = root.querySelector<HTMLElement>(`[data-constellation-port="${meta.id}"]`);
    if (!node || !port) return [];
    const n = node.getBoundingClientRect();
    const p = port.getBoundingClientRect();
    const from = toLocal(n.left + n.width / 2, n.top + n.height / 2);
    const to = toLocal(p.left + p.width / 2, p.top + p.height / 2);
    return [{ ...meta, d: cubicLink(from.x, from.y, to.x, to.y) }];
  });
}

function ConstellationStage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<ConstellationLink[]>([]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const update = () => setLinks(measureLinks(root));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      className="relative mx-auto mt-12 hidden h-[min(38rem,72svh)] w-full max-w-6xl lg:block"
    >
      <div className="pointer-events-none absolute inset-0 rounded-[2rem] bg-[radial-gradient(ellipse_at_center,rgba(254,114,0,0.16),transparent_68%)]" />
      <ConstellationLinks links={links} />
      <PlatformMock className="absolute top-1/2 left-1/2 z-20 w-[min(20rem,40%)] -translate-x-1/2 -translate-y-1/2" />
      <VendasCard className="absolute top-[8%] left-[4%] xl:left-[8%]" />
      <CrmCard className="absolute top-[36%] left-[2%] xl:left-[5%]" />
      <PlanilhaCard className="absolute top-[58%] left-[6%] xl:left-[10%]" />
      <WhatsAppCard className="absolute bottom-[4%] left-[16%] xl:left-[20%]" />
      <InstagramCard className="absolute top-[8%] right-[4%] xl:right-[8%]" />
      <NpsCard className="absolute top-[30%] right-[2%] xl:right-[5%]" />
      <CampanhasCard className="absolute top-[52%] right-[8%] xl:right-[12%]" />
      <ErpCard className="absolute bottom-[4%] right-[14%] xl:right-[18%]" />
    </div>
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

      <ConstellationStage />
    </section>
  );
}
