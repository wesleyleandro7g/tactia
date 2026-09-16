'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';

const PROMPTS = [
  'Onde estou perdendo dinheiro na minha empresa?',
  'Qual é o maior problema da minha empresa hoje?',
  'Quanto posso faturar a mais recuperando clientes inativos?',
  'Quais produtos me dão mais lucro?',
  'O que está impedindo minha empresa de faturar mais?',
  'Vou bater minha meta de faturamento este mês?',
  'Quais clientes devo contatar amanhã?',
  'Qual foi a principal reclamação dos clientes essa semana?',
  'Crie um plano para aumentar meu faturamento em 15%.',
] as const;

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function HeroPrompt() {
  const router = useRouter();
  const cardRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [promptIndex, setPromptIndex] = useState(0);
  const [ghost, setGhost] = useState('');
  const [glass, setGlass] = useState<{
    parent: HTMLElement;
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  const paused = focused || value.length > 0;

  useEffect(() => {
    const card = cardRef.current;
    const section = card?.closest('section');
    if (!card || !section) return;

    const sync = () => {
      const cardRect = card.getBoundingClientRect();
      const sectionRect = section.getBoundingClientRect();
      setGlass({
        parent: section,
        top: cardRect.top - sectionRect.top,
        left: cardRect.left - sectionRect.left,
        width: cardRect.width,
        height: cardRect.height,
      });
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(card);
    observer.observe(section);
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    };
  }, []);

  useEffect(() => {
    if (paused) return;
    if (prefersReducedMotion()) {
      setGhost(PROMPTS[0]);
      setPromptIndex(0);
      return;
    }

    let index = 0;
    let count = 0;
    let mode: 'type' | 'hold' | 'erase' = 'type';
    let timer = 0;

    const step = () => {
      const prompt = PROMPTS[index] ?? '';
      if (mode === 'type') {
        count += 1;
        setPromptIndex(index);
        setGhost(prompt.slice(0, count));
        if (count >= prompt.length) {
          mode = 'hold';
          timer = window.setTimeout(step, 1700);
          return;
        }
        timer = window.setTimeout(step, 36 + (count % 4) * 8);
        return;
      }
      if (mode === 'hold') {
        mode = 'erase';
        timer = window.setTimeout(step, 16);
        return;
      }
      count -= 1;
      setGhost(prompt.slice(0, Math.max(0, count)));
      if (count <= 0) {
        index = (index + 1) % PROMPTS.length;
        mode = 'type';
        timer = window.setTimeout(step, 260);
        return;
      }
      timer = window.setTimeout(step, 14);
    };

    timer = window.setTimeout(step, 420);
    return () => window.clearTimeout(timer);
  }, [paused]);

  function submit(event?: React.FormEvent) {
    event?.preventDefault();
    const asked = value.trim() || PROMPTS[promptIndex];
    const query = new URLSearchParams({ pergunta: asked });
    router.push(`/signup?${query.toString()}`);
  }

  return (
    <>
    <form data-hero-epicenter onSubmit={submit} className="w-full max-w-xl text-left">
      <label htmlFor="hero-pergunta" className="sr-only">
        Pergunte sobre o seu negócio
      </label>
      <div
        ref={cardRef}
        className="group relative overflow-hidden rounded-2xl border border-white/25 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35)] transition-shadow focus-within:border-primary focus-within:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45),0_0_0_4px_rgba(254,114,0,0.18)]"
      >
        <textarea
          id="hero-pergunta"
          name="pergunta"
          rows={2}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder=""
          autoComplete="off"
          spellCheck={false}
          className="relative z-[1] min-h-36 w-full resize-none bg-transparent px-5 py-5 pr-16 text-base leading-relaxed font-normal text-white outline-none placeholder:text-transparent sm:text-lg"
        />
        {value.length === 0 ? (
          <p aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1] px-5 py-5 pr-16 text-base leading-relaxed font-normal text-white sm:text-lg">
            {ghost}
            <span className="ml-0.5 inline-block h-[1.05em] w-px translate-y-[3px] bg-primary align-middle motion-safe:animate-pulse" />
          </p>
        ) : null}
        <button
          type="submit"
          aria-label="Começar com essa pergunta"
          className="absolute right-3 bottom-3 z-[1] grid size-10 place-items-center rounded-full bg-brand text-white shadow-[0_8px_24px_rgba(254,114,0,0.4)] transition-opacity hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <ArrowRight className="size-4" aria-hidden="true" />
        </button>
      </div>
    </form>
    {glass
      ? createPortal(
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-[2] rounded-2xl border border-white/20 bg-[#131212]/45 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.28)] backdrop-blur-3xl backdrop-saturate-150"
            style={{
              top: glass.top,
              left: glass.left,
              width: glass.width,
              height: glass.height,
              backdropFilter: 'blur(32px) saturate(1.4)',
              WebkitBackdropFilter: 'blur(32px) saturate(1.4)',
            }}
          />,
          glass.parent,
        )
      : null}
    </>
  );
}
