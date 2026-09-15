import { Building, Database, FileText, Files, LayoutDashboard, MessageCircle, Target, Users, Wand, Zap } from 'lucide-react';
import { LandingCta } from '@/components/landing/landing-cta';

const PILLARS = [
  {
    title: 'Análise',
    body: 'Pergunte sobre a sua empresa no chat ou no dashboard e receba respostas com números citados a partir dos seus dados.',
    icon: LayoutDashboard,
  },
  {
    title: 'Planejamento',
    body: 'Defina objetivos, acompanhe briefings e use playbooks para receber um plano de ação alinhado ao que os dados mostram.',
    icon: Target,
  },
  {
    title: 'Agente',
    body: 'Peça campanhas, relatórios e outras execuções. O que precisa de confirmação entra na fila de aprovações — inclusive pelo WhatsApp.',
    icon: Zap,
  },
] as const;

const CONNECTIONS = [
  { label: 'WhatsApp', icon: MessageCircle },
  { label: 'Excel', icon: Files },
  { label: 'PostgreSQL', icon: Database },
  { label: 'ERP', icon: Building },
  { label: 'CRM', icon: Users },
  { label: 'CSV', icon: FileText },
] as const;

const BENEFITS = [
  { title: 'Mais produtividade', icon: Wand },
  { title: 'Decisões mais inteligentes', icon: LayoutDashboard },
  { title: 'Crescimento sustentável', icon: Target },
] as const;

export function LandingStory() {
  return (
    <>
      <section className="relative z-10 mx-auto w-full max-w-6xl px-5 py-20 sm:px-8">
        <p className="text-center text-sm font-medium tracking-[0.18em] text-[#fe7200] uppercase">
          O AI Manager para o seu negócio
        </p>
        <h2 className="mx-auto mt-3 max-w-2xl text-center font-landing text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
          Transforme seus dados em insights, planeje o crescimento e execute ações com inteligência artificial.
        </h2>
        <div className="mt-12 grid gap-8 sm:grid-cols-3">
          {PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <article key={pillar.title} className="text-center sm:text-left">
                <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-[#fe7200]/30 bg-[#fe7200]/10 text-[#fe7200] sm:mx-0">
                  <Icon className="size-5" aria-hidden="true" />
                </div>
                <h3 className="mt-4 font-landing text-xl font-bold text-foreground">{pillar.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{pillar.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-16 sm:px-8">
        <div className="flex flex-col items-center gap-6">
          <div className="flex flex-wrap items-center justify-center gap-3">
            {CONNECTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <span
                  key={item.label}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3.5 py-2 text-sm font-medium text-foreground shadow-sm"
                >
                  <Icon className="size-4 text-[#fe7200]" aria-hidden="true" />
                  {item.label}
                </span>
              );
            })}
            <span className="inline-flex size-10 items-center justify-center rounded-full border border-[#fe7200]/40 bg-[#fe7200]/10 font-landing text-lg font-bold text-[#fe7200]">
              +
            </span>
          </div>
          <p className="max-w-md text-center text-sm leading-relaxed text-muted-foreground">
            Conecte seus <span className="font-medium text-foreground">dados</span> e{' '}
            <span className="font-medium text-[#fe7200]">ferramentas</span> de forma simples e integrada.
          </p>
        </div>
      </section>
    </>
  );
}

export function LandingClose() {
  return (
    <section className="relative z-10 mx-auto w-full max-w-6xl px-5 pt-10 pb-24 text-center sm:px-8">
      <LandingCta href="/signup" className="h-12 px-8 text-base">
        Comece agora
      </LandingCta>
      <p className="mt-5 text-sm text-muted-foreground">Mais controle. Mais resultado. Com IA.</p>
      <ul className="mt-10 flex flex-col items-center justify-center gap-6 sm:flex-row sm:gap-12">
        {BENEFITS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.title} className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Icon className="size-4 text-[#fe7200]" aria-hidden="true" />
              {item.title}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="relative z-10 border-t border-border/50 px-5 py-8 text-center sm:px-8">
      <p className="font-landing text-sm font-semibold tracking-tight text-foreground">
        Entenda. Decida. Execute.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">Tactia</p>
    </footer>
  );
}
