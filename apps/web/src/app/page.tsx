import type { Metadata } from 'next';
import { DataConstellation } from '@/components/landing/data-constellation';
import { LandingAtmosphere } from '@/components/landing/landing-atmosphere';
import { LandingClose, LandingFooter, LandingStory } from '@/components/landing/landing-story';
import { HeroPrompt } from '@/components/landing/hero-prompt';
import { LandingNav } from '@/components/landing/landing-nav';
import { ProductStage } from '@/components/landing/product-stage';
import { HeroWebThreads } from '@/components/landing/web-threads';

export const metadata: Metadata = {
  title: 'Tactia — O AI Manager para o seu negócio',
  description:
    'Seus dados já sabem a resposta. A Tactia te ajuda a encontrá-la. A Tactia transforma os dados da sua empresa em insights claros para você entender o que está acontecendo, decidir melhor e agir com inteligência.',
};

export default function HomePage() {
  return (
    <div className="dark scheme-dark relative min-h-screen overflow-x-hidden bg-background">
      <LandingAtmosphere />
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm"
      >
        Pular para o conteúdo
      </a>
      <LandingNav />
      <main id="conteudo" className="relative z-10">
        <section className="relative isolate min-h-[calc(100svh-4.25rem)] w-full overflow-hidden">
          <div className="absolute inset-0 z-0">
            <HeroWebThreads anchorSelector="[data-hero-epicenter]" />
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-24 bg-gradient-to-b from-background/80 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-28 bg-gradient-to-t from-background to-transparent" />

          <div className="relative z-10 mx-auto flex min-h-[calc(100svh-4.25rem)] w-full max-w-6xl flex-col items-center justify-center px-5 py-20 text-center sm:px-8 lg:py-24">
            <div className="animate-landing-enter w-full max-w-4xl">
              <p className="mx-auto mb-5 inline-flex w-fit items-center gap-2.5 rounded-full border border-white/18 bg-white/[0.08] py-1.5 pr-3.5 pl-2.5 text-[13px] font-medium tracking-wide text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22),0_12px_32px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                <span className="size-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_10px_2px_rgba(255,122,26,0.75)]" aria-hidden="true" />
                <span>Entenda</span>
                <span className="text-primary" aria-hidden="true">
                  ·
                </span>
                <span>Decida</span>
                <span className="text-primary" aria-hidden="true">
                  ·
                </span>
                <span>Execute</span>
              </p>
              <h1 className="font-landing text-[2.85rem] leading-[1.02] font-extrabold tracking-tight text-foreground sm:text-6xl lg:text-[4.5rem]">
                Seus dados já sabem a <span className="text-brand">resposta</span>. A{' '}
                <span className="text-brand">Tactia</span> te ajuda a encontrá-la.
              </h1>
              <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-white sm:text-lg">
                A Tactia transforma os dados da sua empresa em insights claros para você entender o
                que está acontecendo, decidir melhor e agir com inteligência.
              </p>
            </div>
            <div className="animate-landing-fade mt-8 flex w-full justify-center [animation-delay:180ms]">
              <HeroPrompt />
            </div>
          </div>
        </section>
        <LandingStory />
        <ProductStage />
        <DataConstellation />
        <LandingClose />
      </main>
      <LandingFooter />
    </div>
  );
}
