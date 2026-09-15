import type { ReactNode } from 'react';
import Image from 'next/image';
import {
  Bell,
  Building2,
  Files,
  Instagram,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  MessageCircle,
  Search,
  Settings,
  Table,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/** Exit nodes of each source card → dashboard entry. Coords in stage % (viewBox 0 0 100 100). */
const DASH_ENTRY = { x: 61, y: 46.5 } as const;

const SOURCE_NODES = [
  { id: 'vendas', x: 15.8, y: 13.1 },
  { id: 'crm', x: 31.6, y: 13.1 },
  { id: 'planilha', x: 14.2, y: 37.3 },
  { id: 'whatsapp', x: 29.5, y: 38.0 },
  { id: 'campanhas', x: 13.8, y: 63.4 },
  { id: 'instagram', x: 28.2, y: 61.6 },
  { id: 'erp', x: 42.9, y: 65.9 },
  { id: 'nps', x: 42.0, y: 25.2 },
] as const;

function streamPath(x: number, y: number) {
  const { x: tx, y: ty } = DASH_ENTRY;
  // Pull mid control toward center so paths funnel before hitting the tablet
  const c1x = x + (tx - x) * 0.28;
  const c1y = y + (ty - y) * 0.08;
  const c2x = x + (tx - x) * 0.62;
  const c2y = ty + (y - ty) * 0.18;
  return `M ${x.toFixed(2)} ${y.toFixed(2)} C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${tx} ${ty}`;
}

const STREAMS = [
  ...SOURCE_NODES.map((node) => ({
    id: node.id,
    d: streamPath(node.x, node.y),
    x: node.x,
    y: node.y,
  })),
  // Extra filaments between nodes for density
  ...[
    { id: 'mid-a', x: 18.5, y: 24.5 },
    { id: 'mid-b', x: 24.0, y: 49.0 },
    { id: 'mid-c', x: 36.0, y: 43.0 },
    { id: 'mid-d', x: 22.0, y: 56.0 },
  ].map((node) => ({
    id: node.id,
    d: streamPath(node.x, node.y),
    x: node.x,
    y: node.y,
  })),
] as const;

const PARTICLES = STREAMS.flatMap((stream, pathIndex) =>
  [0, 0.14, 0.28, 0.44, 0.6, 0.78, 0.96, 1.18, 1.42, 1.7].map((stagger, particleIndex) => ({
    id: `${stream.id}-${particleIndex}`,
    d: stream.d,
    x: stream.x,
    y: stream.y,
    delay: pathIndex * 0.07 + stagger,
    dur: 1.85 + (particleIndex % 4) * 0.25,
    r: particleIndex % 4 === 0 ? 0.55 : particleIndex % 3 === 0 ? 0.38 : particleIndex % 2 === 0 ? 0.28 : 0.2,
  })),
);

const FLOOR_DOTS = Array.from({ length: 72 }, (_, i) => {
  const col = i % 12;
  const row = Math.floor(i / 12);
  const x = 4 + col * 8.5 + (row % 2) * 3.2;
  const y = 78 + row * 4.2 + Math.sin(col * 0.7) * 1.8;
  const r = 0.35 + ((col + row) % 4) * 0.18;
  return { id: `f-${i}`, x, y, r, delay: (i % 9) * 0.35 };
});

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
  delay: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'absolute z-10 rounded-2xl border border-white/[0.09] bg-[#1a1918]/94 p-3 shadow-[0_20px_48px_rgba(0,0,0,0.45)] backdrop-blur-md motion-safe:animate-landing-float',
        className,
      )}
      style={{ animationDelay: delay }}
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

function HeroDashboard() {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-6 rounded-[2rem] bg-[radial-gradient(ellipse_at_center,rgba(254,114,0,0.42),transparent_68%)] blur-xl motion-safe:animate-landing-pulse" />
      <div className="relative overflow-hidden rounded-[1.55rem] border border-white/12 bg-[#121110] shadow-[0_32px_100px_rgba(254,114,0,0.32),0_0_0_1px_rgba(254,114,0,0.18)]">
        <div className="flex min-h-[22rem]">
          <aside className="flex w-11 shrink-0 flex-col items-center gap-3 border-r border-white/8 bg-[#0e0d0c] py-3">
            <Image src="/tactia-symbol.svg" alt="" width={20} height={20} className="size-5" unoptimized />
            <span className="flex size-7 items-center justify-center rounded-lg bg-[#fe7200]/18 text-[#fe7200]">
              <LayoutDashboard className="size-3.5" />
            </span>
            <LayoutGrid className="size-3.5 text-white/35" />
            <Table className="size-3.5 text-white/35" />
            <Users className="size-3.5 text-white/35" />
            <Settings className="size-3.5 text-white/35" />
            <LogOut className="mt-auto size-3.5 text-white/30" />
          </aside>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 border-b border-white/8 px-3.5 py-2.5">
              <p className="truncate text-[11px] font-medium tracking-wide text-[#f4efea]/85">AI dashboard</p>
              <div className="flex items-center gap-1.5">
                <span className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] text-[#a89f98] sm:inline-flex">
                  <Search className="size-2.5" /> Buscar
                </span>
                <Bell className="size-3 text-white/40" />
                <span className="rounded-full border border-[#fe7200]/45 bg-[#fe7200]/12 px-2 py-0.5 text-[8px] font-semibold tracking-[0.1em] text-[#fe7200]">
                  INSIGHT
                </span>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1.5 px-3 pt-3">
              {[
                { label: 'Receita', value: '+12,5%', tone: 'text-[#3ecf8e]' },
                { label: 'Vendas', value: '+18,2%', tone: 'text-[#3ecf8e]' },
                { label: 'Ticket médio', value: '+8,3%', tone: 'text-[#3ecf8e]' },
                { label: 'Conversão', value: '+8,3%', tone: 'text-[#fe7200]' },
              ].map((metric) => (
                <div key={metric.label} className="rounded-lg bg-white/[0.045] px-1.5 py-1.5">
                  <p className="truncate text-[8px] text-[#a89f98]">{metric.label}</p>
                  <p className={cn('mt-0.5 font-landing text-[11px] font-semibold', metric.tone)}>{metric.value}</p>
                </div>
              ))}
            </div>

            <div className="px-3 pt-2.5">
              <p className="text-[9px] text-[#a89f98]">Receita e crescimento</p>
              <svg viewBox="0 0 280 88" className="mt-0.5 h-[4.25rem] w-full" aria-hidden="true">
                <defs>
                  <linearGradient id="landing-hero-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fe7200" stopOpacity="0.42" />
                    <stop offset="100%" stopColor="#fe7200" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <g stroke="rgba(255,255,255,0.05)" strokeWidth="1">
                  <line x1="0" y1="22" x2="280" y2="22" />
                  <line x1="0" y1="44" x2="280" y2="44" />
                  <line x1="0" y1="66" x2="280" y2="66" />
                </g>
                <path
                  d="M0 70 C 28 64, 42 58, 58 52 S 90 48, 112 40 S 150 22, 172 28 S 220 18, 248 12 L 280 8 L 280 88 L 0 88 Z"
                  fill="url(#landing-hero-area)"
                />
                <path
                  className="landing-chart-draw"
                  d="M0 70 C 28 64, 42 58, 58 52 S 90 48, 112 40 S 150 22, 172 28 S 220 18, 248 12 L 280 8"
                  fill="none"
                  stroke="#fe7200"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            <div className="grid grid-cols-2 gap-2 px-3 pb-3 pt-1">
              <div className="rounded-xl border border-[#fe7200]/45 bg-[#fe7200]/10 p-2.5 shadow-[0_0_24px_rgba(254,114,0,0.22)]">
                <p className="text-[9px] font-semibold tracking-wide text-[#fe7200]">AI recomendações</p>
                <p className="mt-1 text-[10px] leading-snug text-[#f4efea]/85">
                  Aumentar investimento no canal com maior conversão.
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                <p className="text-[9px] font-semibold tracking-wide text-[#a89f98]">Próximo passo</p>
                <p className="mt-1 text-[10px] leading-snug text-[#f4efea]/75">
                  Revisar funil de vendas e priorizar ações desta semana.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DataStream() {
  const { x: tx, y: ty } = DASH_ENTRY;

  return (
    <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="landing-funnel-fill" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fe7200" stopOpacity="0" />
          <stop offset="30%" stopColor="#fe7200" stopOpacity="0.08" />
          <stop offset="70%" stopColor="#fe7200" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ffc078" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="landing-stream-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fe7200" stopOpacity="0.15" />
          <stop offset="35%" stopColor="#fe7200" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#ffd090" stopOpacity="1" />
        </linearGradient>
        <linearGradient id="landing-beam-core" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#fe7200" stopOpacity="0" />
          <stop offset="45%" stopColor="#fe7200" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fff0d0" stopOpacity="0.95" />
        </linearGradient>
        <filter id="landing-funnel-blur" x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
        <filter id="landing-particle-glow" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="0.35" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="landing-stream-glow" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="0.35" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="landing-beam-bloom" x="-40%" y="-120%" width="180%" height="340%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
      </defs>

      <polygon
        points={`12,10 ${tx},${ty - 7} ${tx},${ty + 7} 12,70`}
        fill="url(#landing-funnel-fill)"
        filter="url(#landing-funnel-blur)"
      />

      <g opacity="0.5" filter="url(#landing-funnel-blur)">
        {STREAMS.map((stream) => (
          <path key={`glow-${stream.id}`} d={stream.d} fill="none" stroke="#fe7200" strokeWidth="0.85" strokeLinecap="round" />
        ))}
      </g>

      <g filter="url(#landing-stream-glow)">
        {STREAMS.map((stream) => (
          <path
            key={stream.id}
            d={stream.d}
            fill="none"
            stroke="url(#landing-stream-fade)"
            strokeWidth="0.32"
            strokeLinecap="round"
            className="landing-stream"
          />
        ))}
      </g>

      <ellipse cx={tx - 4} cy={ty} rx="7" ry="3.2" fill="#fe7200" opacity="0.42" filter="url(#landing-beam-bloom)" />
      <path
        d={`M ${tx - 14} ${ty} L ${tx} ${ty}`}
        fill="none"
        stroke="url(#landing-beam-core)"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.7"
        filter="url(#landing-beam-bloom)"
      />
      <path
        d={`M ${tx - 12} ${ty} L ${tx} ${ty}`}
        fill="none"
        stroke="#fff2d8"
        strokeWidth="0.35"
        strokeLinecap="round"
        opacity="0.95"
        filter="url(#landing-particle-glow)"
      />

      <g className="landing-particles" filter="url(#landing-particle-glow)">
        {PARTICLES.map((particle) => (
          <circle key={particle.id} cx={particle.x} cy={particle.y} r={particle.r} fill="#fe7200">
            <animateMotion
              dur={`${particle.dur}s`}
              begin={`${particle.delay}s`}
              repeatCount="indefinite"
              path={particle.d}
            />
          </circle>
        ))}
        {SOURCE_NODES.flatMap((node, i) =>
          [0.35, 1.05].map((stagger, j) => (
            <circle key={`spark-${node.id}-${j}`} cx={node.x} cy={node.y} r={0.62} fill="#ffd090" opacity="0.95">
              <animateMotion
                dur={`${1.45 + j * 0.2}s`}
                begin={`${i * 0.12 + stagger}s`}
                repeatCount="indefinite"
                path={streamPath(node.x, node.y)}
              />
            </circle>
          )),
        )}
      </g>
    </svg>
  );
}

function ParticleFloor() {
  return (
    <svg
      viewBox="0 0 100 100"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[28%] w-full opacity-35"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="landing-floor-fade" cx="50%" cy="0%" r="85%">
          <stop offset="0%" stopColor="#fe7200" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#fe7200" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#fe7200" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="landing-floor-mask" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity="0" />
          <stop offset="35%" stopColor="white" stopOpacity="0.7" />
          <stop offset="100%" stopColor="white" stopOpacity="1" />
        </linearGradient>
        <mask id="landing-floor-soft">
          <rect width="100" height="100" fill="url(#landing-floor-mask)" />
        </mask>
      </defs>
      <g mask="url(#landing-floor-soft)">
        {FLOOR_DOTS.map((dot) => (
          <circle
            key={dot.id}
            cx={dot.x}
            cy={dot.y}
            r={dot.r}
            fill="url(#landing-floor-fade)"
            className="landing-floor-dot"
            style={{ animationDelay: `${dot.delay}s` }}
          />
        ))}
        {FLOOR_DOTS.slice(0, 40).map((dot, i) => {
          const next = FLOOR_DOTS[i + 1];
          if (!next || i % 3 !== 0) return null;
          return (
            <line
              key={`l-${dot.id}`}
              x1={dot.x}
              y1={dot.y}
              x2={next.x}
              y2={next.y}
              stroke="#fe7200"
              strokeOpacity="0.12"
              strokeWidth="0.15"
            />
          );
        })}
      </g>
    </svg>
  );
}

const SOURCE_PILLS = [
  { label: 'CRM', icon: Users },
  { label: 'ERP', icon: Building2 },
  { label: 'Planilhas', icon: Files },
  { label: 'WhatsApp', icon: MessageCircle },
  { label: 'Instagram', icon: Instagram },
] as const;

/** Fontes de dados fluindo para o dashboard. Decorativa. */
export function DataConstellation() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-6xl">
      <div className="mb-5 flex flex-wrap justify-center gap-2 md:hidden">
        {SOURCE_PILLS.map((item) => {
          const Icon = item.icon;
          return (
            <span
              key={item.label}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#171615]/90 px-3 py-1.5 text-[11px] font-medium text-[#f4efea]"
            >
              <Icon className="size-3 text-[#fe7200]" />
              {item.label}
            </span>
          );
        })}
      </div>

      <div className="relative min-h-[22rem] md:min-h-[30rem] lg:min-h-[32rem]">
        <ParticleFloor />

        <div className="landing-stream-frame pointer-events-none z-[5] hidden md:block">
          <DataStream />
        </div>

        <div className="pointer-events-none absolute top-1/2 right-[24%] z-20 hidden h-48 w-52 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(254,114,0,0.72),transparent_68%)] blur-lg motion-safe:animate-landing-pulse md:block" />
        <div className="pointer-events-none absolute top-[42%] right-[38%] z-10 hidden h-24 w-64 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(254,114,0,0.35),transparent_70%)] blur-md md:block" />

        <div className="absolute inset-0 hidden md:block">
          <SourceCard className="top-[3%] left-[1%] w-[10.2rem]" delay="0s">
            <p className="text-[10px] text-[#a89f98]">Vendas</p>
            <p className="font-landing text-lg font-semibold text-white">R$ 57.535</p>
            <div className="mt-1 flex items-center justify-between text-[#3ecf8e]">
              <span className="text-[10px] font-medium">+12,6%</span>
              <Sparkline className="text-[#fe7200]" d="M1 16 C 12 14, 18 8, 28 10 S 48 4, 71 6" />
            </div>
            <NodeGlow className="top-1/2 -right-1" />
          </SourceCard>

          <SourceCard className="top-[2%] left-[18%] w-[9.4rem]" delay="0.35s">
            <p className="flex items-center gap-1 text-[9px] font-semibold tracking-[0.12em] text-[#fe7200] uppercase">
              <Users className="size-3" /> CRM
            </p>
            <p className="mt-1 font-landing text-lg font-semibold text-white">378.893</p>
            <p className="text-[10px] text-[#a89f98]">clientes no período</p>
            <NodeGlow className="top-[60%] -right-1" />
          </SourceCard>

          <SourceCard className="top-[26%] left-0 w-[9.8rem]" delay="0.7s">
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

          <SourceCard className="top-[28%] left-[17%] w-[8.6rem] !p-2.5" delay="1s">
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

          <SourceCard className="top-[54%] left-[1%] w-[8.8rem]" delay="1.35s">
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
            <NodeGlow className="top-1/2 -right-1" />
          </SourceCard>

          <SourceCard className="top-[52%] left-[16%] w-[8.4rem]" delay="1.65s">
            <p className="flex items-center gap-1 text-[9px] font-semibold tracking-[0.12em] text-[#fe7200] uppercase">
              <Instagram className="size-3" /> Instagram
            </p>
            <p className="mt-1 font-landing text-lg font-semibold text-white">12.4k</p>
            <p className="text-[10px] text-[#a89f98]">alcance no período</p>
            <NodeGlow className="top-[58%] -right-1" />
          </SourceCard>

          <SourceCard className="top-[58%] left-[31%] z-[15] w-[8.2rem]" delay="2s">
            <p className="flex items-center gap-1 text-[9px] font-semibold tracking-[0.12em] text-[#fe7200] uppercase">
              <Building2 className="size-3" /> ERP
            </p>
            <p className="mt-1 font-landing text-lg font-semibold text-white">R$ 236</p>
            <p className="text-[10px] text-[#a89f98]">ticket operacional</p>
            <NodeGlow className="top-1/2 -right-1" />
          </SourceCard>

          <SourceCard className="top-[12%] left-[34%] z-[12] w-[5.6rem] !p-2.5" delay="0.55s">
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
            <NodeGlow className="-right-1 bottom-3" />
          </SourceCard>
        </div>

        <div className="relative z-30 mx-auto w-full max-w-[22.5rem] md:absolute md:top-1/2 md:right-0 md:max-w-[25rem] md:-translate-y-1/2 lg:max-w-[26.5rem]">
          <HeroDashboard />
        </div>
      </div>
    </div>
  );
}
