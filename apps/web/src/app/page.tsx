import type { Metadata } from 'next';
import { DataConstellation } from '@/components/landing/data-constellation';
import { LandingAtmosphere } from '@/components/landing/landing-atmosphere';
import { LandingClose, LandingFooter, LandingStory } from '@/components/landing/landing-story';
import { LandingCta } from '@/components/landing/landing-cta';
import { LandingNav } from '@/components/landing/landing-nav';
import { ProductStage } from '@/components/landing/product-stage';

export const metadata: Metadata = {
  title: 'Tactia — O AI Manager para o seu negócio',
  description:
    'Seus dados já sabem a resposta. A Ta te ajuda a encontrá-la. Transforme dados espalhados em insights claros para decidir o que fazer.',
};

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background">
      <LandingAtmosphere />
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm"
      >
        Pular para o conteúdo
      </a>
      <LandingNav />
      <main id="conteudo" className="relative z-10">
        <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-5 pt-12 pb-12 text-center sm:px-8 lg:pt-16 lg:pb-14">
          <div className="animate-landing-enter w-full max-w-3xl">
            <h1 className="font-landing text-[2.35rem] leading-[1.05] font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-[3.2rem]">
              Seus dados já sabem a <span className="text-brand">resposta</span>. A Ta te ajuda a encontrá-la.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Transforme dados espalhados em insights claros para decidir o que fazer.
            </p>
          </div>
          <div className="animate-landing-enter mt-10 w-full [animation-delay:140ms] lg:mt-12">
            <DataConstellation />
          </div>
          <div className="animate-landing-enter mt-8 flex flex-col items-center gap-3 [animation-delay:220ms]">
            <LandingCta
              href="/signup"
              className="h-auto min-h-12 whitespace-normal px-6 py-3 text-center leading-snug sm:h-12 sm:whitespace-nowrap sm:px-8 sm:py-0"
            >
              Descubra o que seus dados estão dizendo
            </LandingCta>
            <p className="text-sm tracking-wide text-muted-foreground">Entenda. Decida. Execute.</p>
          </div>
        </section>
        <LandingStory />
        <ProductStage />
        <LandingClose />
      </main>
      <LandingFooter />
    </div>
  );
}
