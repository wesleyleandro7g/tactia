import Image from 'next/image';
import { ClipboardCheck, FileText, LayoutDashboard, MessageSquare, Target, Zap } from 'lucide-react';

const NAV = [
  { label: 'Dashboard', icon: LayoutDashboard, active: false },
  { label: 'Briefings', icon: FileText, active: false },
  { label: 'Chat', icon: MessageSquare, active: true },
  { label: 'Aprovações', icon: ClipboardCheck, active: false },
] as const;

const ACTIONS = [
  { title: 'Análise', caption: 'Entenda sua empresa', icon: LayoutDashboard },
  { title: 'Planejamento', caption: 'Defina metas e ações', icon: Target },
  { title: 'Agente', caption: 'Execute com IA', icon: Zap },
] as const;

export function ProductStage() {
  return (
    <section className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-8 sm:px-8">
      <h2 className="sr-only">A Tactia no computador: chat, métricas e recomendações</h2>
      <div aria-hidden="true" className="relative mx-auto max-w-5xl">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-10 bottom-[-10%] h-[55%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(254,114,0,0.28),transparent_70%)] blur-2xl motion-safe:animate-landing-pulse"
        />
        <div className="relative overflow-hidden rounded-[1.6rem] border border-white/12 bg-[#0f0e0d] p-2 shadow-[0_40px_100px_rgba(254,114,0,0.2)] sm:p-2.5">
          <div className="overflow-hidden rounded-[1.15rem] border border-white/6 bg-[#161514]">
            <div className="flex min-h-[22rem] sm:min-h-[26rem]">
              <div className="hidden w-[11.5rem] shrink-0 border-r border-white/8 bg-[#121110] p-3 sm:block">
                <div className="mb-4 flex items-center gap-2 px-1">
                  <Image src="/tactia-symbol.svg" alt="" width={18} height={18} className="size-[18px]" unoptimized />
                  <span className="font-landing text-sm font-semibold text-[#f4efea]">Tactia</span>
                </div>
                <ul className="space-y-1">
                  {NAV.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li
                        key={item.label}
                        className={
                          item.active
                            ? 'flex items-center gap-2 rounded-lg bg-[#fe7200]/18 px-2.5 py-2 text-[12px] font-medium text-[#fe7200]'
                            : 'flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] text-[#a89f98]'
                        }
                      >
                        <Icon className="size-3.5" />
                        {item.label}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="flex min-w-0 flex-1 flex-col px-4 py-5 sm:px-6">
                <p className="font-landing text-2xl font-semibold tracking-tight text-[#f4efea] sm:text-[1.7rem]">
                  Olá, como posso te ajudar hoje?
                </p>
                <div className="mt-4 flex items-center gap-2 rounded-full border border-white/10 bg-white/4 px-4 py-2.5 text-[12px] text-[#a89f98]">
                  Faça uma análise do meu negócio…
                  <span className="ml-auto grid size-7 place-items-center rounded-full bg-brand text-white">
                    <Zap className="size-3.5" />
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {ACTIONS.map((action) => {
                    const Icon = action.icon;
                    return (
                      <div
                        key={action.title}
                        className="rounded-xl border border-white/8 bg-white/4 p-3"
                      >
                        <Icon className="size-4 text-[#fe7200]" />
                        <p className="mt-2 text-[13px] font-semibold text-[#f4efea]">{action.title}</p>
                        <p className="text-[11px] text-[#a89f98]">{action.caption}</p>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/8 bg-white/4 p-3">
                    <p className="text-[10px] text-[#a89f98]">Visão geral do negócio</p>
                    <p className="mt-1 font-landing text-xl font-semibold text-[#f4efea]">R$ 458.720</p>
                    <p className="text-[11px] font-medium text-[#3ecf8e]">+12,5%</p>
                    <svg viewBox="0 0 160 36" className="mt-2 h-8 w-full" aria-hidden="true">
                      <path
                        d="M0 28 C 20 26, 32 22, 48 18 S 80 16, 96 10 S 130 8, 160 4"
                        fill="none"
                        stroke="#fe7200"
                        strokeWidth="2"
                      />
                    </svg>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-white/4 p-3">
                    <p className="text-[10px] text-[#a89f98]">Principais insights</p>
                    <ul className="mt-2 space-y-1.5 text-[11px] text-[#d8d0c8]">
                      <li className="text-[#3ecf8e]">Vendas no último mês cresceram 12,5%</li>
                      <li className="text-[#3ecf8e]">Ticket médio aumentou 8,3%</li>
                      <li className="text-[#a89f98]">Produtos mais vendidos: Categoria A e B</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="mx-auto h-3 w-[72%] rounded-b-2xl bg-gradient-to-b from-[#2c2927] to-[#1a1817]" />
        <div className="mx-auto h-1.5 w-[28%] rounded-b-full bg-[#3a3634]" />
      </div>
    </section>
  );
}
