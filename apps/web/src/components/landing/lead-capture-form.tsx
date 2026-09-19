'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Calendar, ArrowLeft } from 'lucide-react';
import {
  ACQUISITION_SEGMENTS,
  ACQUISITION_EMPLOYEES,
  ACQUISITION_REVENUES,
  ACQUISITION_SYSTEMS,
  CONSULTATION_CALENDAR_URL,
  acquisitionLeadSchema,
} from '@tactia/shared/acquisition';
import { BrandLogo } from '@/components/app/brand-logo';
import { AuthAtmosphere } from '@/components/app/auth-atmosphere';
import { ThemeToggle } from '@/components/app/theme-toggle';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { GoogleSchedulingButton } from './google-scheduling-button';

const STEPS = ['Contato', 'Empresa', 'Porte', 'Ferramentas', 'Consultoria'];
const TITLES = [
  'Vamos nos conhecer.',
  'Cada empresa tem seu jeito.',
  'Qual é o seu momento?',
  'Como a operação acontece?',
  'Seu próximo passo começa aqui.',
];
const STEP_FIELDS = [
  ['name', 'email', 'whatsapp', 'phone'],
  ['company', 'segment', 'segmentOther'],
  ['employeeRange', 'revenueRange'],
  ['systems', 'systemDetails', 'context'],
];
type FormData = {
  name: string;
  email: string;
  whatsapp: string;
  phone: string;
  company: string;
  segment: string;
  segmentOther: string;
  employeeRange: string;
  revenueRange: string;
  systems: string[];
  systemDetails: string;
  context: string;
  website: string;
};

function ChoiceCards({
  name,
  legend,
  options,
  values,
  multiple,
  onChange,
  error,
}: {
  name: string;
  legend: string;
  options: readonly string[];
  values: string[];
  multiple?: boolean;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <fieldset aria-describedby={error ? name + '-error' : undefined}>
      <legend className="mb-3 text-sm font-medium">{legend}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((option, index) => (
          <label
            key={option}
            className={cn(
              'relative flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border p-4 text-sm transition-colors hover:border-primary/60',
              values.includes(option)
                ? 'border-primary bg-primary/10'
                : 'border-border bg-background/70',
            )}
          >
            <input
              id={index === 0 ? name : name + '-' + index}
              type={multiple ? 'checkbox' : 'radio'}
              name={name}
              value={option}
              checked={values.includes(option)}
              onChange={() => onChange(option)}
              aria-invalid={!!error}
              aria-describedby={error ? name + '-error' : undefined}
              className="peer size-4 shrink-0 accent-primary"
            />
            <span>{option}</span>
            <span className="pointer-events-none absolute inset-0 rounded-xl peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary" />
          </label>
        ))}
      </div>
      {error && (
        <p id={name + '-error'} role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function LeadCaptureForm({ initialContext }: { initialContext: string }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<FormData>({
    name: '',
    email: '',
    whatsapp: '',
    phone: '',
    company: '',
    segment: '',
    segmentOther: '',
    employeeRange: '',
    revenueRange: '',
    systems: [],
    systemDetails: '',
    context: initialContext,
    website: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const submissionId = useRef<string | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) title.current?.focus();
    mounted.current = true;
  }, [step]);

  function update(key: keyof FormData, value: string | string[]) {
    setData((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: '' }));
  }
  function focusError(fields: Record<string, string>) {
    requestAnimationFrame(() => document.getElementById(Object.keys(fields)[0] ?? '')?.focus());
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submissionId.current ??= crypto.randomUUID();
    const parsed = acquisitionLeadSchema.safeParse({ ...data, submissionId: submissionId.current });
    const relevant = step === 3 ? STEP_FIELDS.flat() : (STEP_FIELDS[step] ?? []);
    const nextErrors: Record<string, string> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        if (relevant.includes(key)) nextErrors[key] ??= issue.message;
      }
    }
    // Later, unanswered enum fields prevent Zod's cross-field refinement from
    // running. Validate this branch as soon as the company step is submitted.
    if (step === 1 && data.segment === 'Outros' && !data.segmentOther.trim()) {
      nextErrors.segmentOther = 'Conte qual é o segmento.';
    }
    setErrors(nextErrors);
    setError('');
    if (Object.keys(nextErrors).length) {
      const firstStep = STEP_FIELDS.findIndex((fields) =>
        fields.includes(Object.keys(nextErrors)[0]!),
      );
      if (firstStep >= 0 && firstStep < step) setStep(firstStep);
      focusError(nextErrors);
      return;
    }
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    if (!parsed.success) {
      setError('Confira os dados antes de enviar.');
      return;
    }
    submitting.current = true;
    setPending(true);
    try {
      const response = await fetch('/api/v1/acquisition-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? 'Muitas tentativas. Aguarde alguns minutos antes de enviar novamente.'
            : 'Não conseguimos salvar seus dados. Confira o formulário e tente novamente.',
        );
      if (!body?.data?.received)
        throw new Error('Não conseguimos confirmar o envio. Tente novamente.');
      setStep(4);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Não foi possível enviar. Tente novamente.',
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  function input(
    key: Exclude<keyof FormData, 'systems'>,
    label: string,
    type = 'text',
    optional = false,
    maxLength = 120,
    autoComplete?: string,
  ) {
    return (
      <Field htmlFor={key} label={label} error={errors[key]}>
        <Input
          id={key}
          name={key}
          type={type}
          required={!optional}
          value={data[key]}
          autoComplete={autoComplete}
          maxLength={maxLength}
          className="h-12"
          aria-invalid={!!errors[key]}
          aria-describedby={errors[key] ? key + '-error' : undefined}
          onChange={(event) => update(key, event.target.value)}
        />
      </Field>
    );
  }

  return (
    <main className="relative min-h-svh overflow-hidden bg-background text-foreground">
      <AuthAtmosphere />
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-6 sm:px-8">
        <Link href="/" aria-label="Tactia, página inicial">
          <BrandLogo className="h-7 sm:h-10" priority />
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
            Já sou cliente
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <div className="relative z-10 mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-6 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16 lg:pt-12">
        <aside className="lg:sticky lg:top-12 lg:self-start">
          <p className="mb-5 font-mono text-xs uppercase tracking-[0.22em] text-primary">
            Consultoria gratuita
          </p>
          <h1 className="font-display text-4xl leading-tight tracking-tight sm:text-5xl">
            Menos tarefas.
            <br />
            Mais possibilidades
            <br className="hidden lg:block" /> para sua empresa.
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
            Vamos olhar de perto sua operação e encontrar onde IA e outras tecnologias podem
            simplificar o trabalho e abrir espaço para crescer.
          </p>
          <div className="mt-8 border-l-2 border-primary pl-4 text-sm leading-relaxed">
            <p className="font-medium">Uma conversa sobre o seu negócio.</p>
            <p className="mt-1 text-muted-foreground">
              Você traz o contexto. Nós ajudamos a identificar oportunidades de otimização e
              automação.
            </p>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            O acesso à plataforma é preparado pela nossa equipe, com acompanhamento próximo.
          </p>
        </aside>
        <section
          aria-label="Solicitar consultoria"
          className="min-w-0 rounded-2xl border border-border bg-card/90 p-5 shadow-xl shadow-black/5 sm:p-8"
        >
          <div className="mb-8">
            <p aria-live="polite" className="mb-3 font-mono text-xs text-muted-foreground">
              Etapa {step + 1} de 5 · {STEPS[step]}
            </p>
            <ol aria-label="Etapas" className="flex gap-2">
              {STEPS.map((label, index) => (
                <li
                  key={label}
                  aria-current={index === step ? 'step' : undefined}
                  className={cn(
                    'h-1.5 flex-1 rounded-full',
                    index <= step ? 'bg-primary' : 'bg-muted',
                  )}
                >
                  <span className="sr-only">
                    {label}
                    {index < step ? ', concluída' : ''}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <h2
            ref={title}
            tabIndex={-1}
            className="mb-6 font-display text-2xl tracking-tight outline-none sm:text-3xl"
          >
            {TITLES[step]}
          </h2>
          {step === 4 ? (
            <div className="space-y-5">
              <div role="status" className="flex gap-3 rounded-xl bg-primary/10 p-4 text-sm">
                <Check aria-hidden="true" className="size-5 shrink-0 text-primary" />
                <p>
                  Recebemos seus dados! Se quiser, clique no botão abaixo para escolher um horário
                  para sua consultoria gratuita.
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                A disponibilidade e a confirmação são feitas pelo Google. Seu contato já está salvo,
                mesmo que você prefira agendar depois.
              </p>
              <GoogleSchedulingButton />
              <a
                href={CONSULTATION_CALENDAR_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-primary underline underline-offset-4"
              >
                <Calendar className="size-4" aria-hidden="true" />
                Abrir agenda em outra aba
              </a>
              <div>
                <Link
                  href="/"
                  className="text-sm text-muted-foreground underline underline-offset-4"
                >
                  Agendar depois e voltar ao início
                </Link>
              </div>
            </div>
          ) : (
            <form noValidate onSubmit={submit} className="space-y-6">
              <fieldset disabled={pending} className="min-w-0 space-y-6">
                {step === 0 && (
                  <>
                    {input('name', 'Seu nome', 'text', false, 120, 'name')}
                    {input('email', 'E-mail', 'email', false, 254, 'email')}
                    <div className="grid gap-5 sm:grid-cols-2">
                      {input('whatsapp', 'WhatsApp com DDD', 'tel', false, 30, 'tel')}
                      {input('phone', 'Telefone alternativo (opcional)', 'tel', true, 30)}
                    </div>
                  </>
                )}
                {step === 1 && (
                  <>
                    {input('company', 'Nome da empresa', 'text', false, 120, 'organization')}
                    <ChoiceCards
                      name="segment"
                      legend="Qual é o seu segmento?"
                      options={ACQUISITION_SEGMENTS}
                      values={[data.segment]}
                      onChange={(value) => update('segment', value)}
                      error={errors.segment}
                    />
                    {data.segment === 'Outros' && input('segmentOther', 'Qual segmento?')}
                  </>
                )}
                {step === 2 && (
                  <>
                    <ChoiceCards
                      name="employeeRange"
                      legend="Quantas pessoas trabalham na empresa?"
                      options={ACQUISITION_EMPLOYEES}
                      values={[data.employeeRange]}
                      onChange={(value) => update('employeeRange', value)}
                      error={errors.employeeRange}
                    />
                    <ChoiceCards
                      name="revenueRange"
                      legend="Qual é o faturamento médio mensal?"
                      options={ACQUISITION_REVENUES}
                      values={[data.revenueRange]}
                      onChange={(value) => update('revenueRange', value)}
                      error={errors.revenueRange}
                    />
                  </>
                )}
                {step === 3 && (
                  <>
                    <ChoiceCards
                      name="systems"
                      legend="Quais ferramentas vocês usam? Selecione todas que se aplicam."
                      options={ACQUISITION_SYSTEMS}
                      values={data.systems}
                      multiple
                      error={errors.systems}
                      onChange={(value) =>
                        update(
                          'systems',
                          value === 'Nenhum'
                            ? ['Nenhum']
                            : data.systems.includes(value)
                              ? data.systems.filter((item) => item !== value)
                              : [...data.systems.filter((item) => item !== 'Nenhum'), value],
                        )
                      }
                    />
                    {input('systemDetails', 'Nomes dos sistemas (opcional)', 'text', true, 500)}
                    <Field
                      htmlFor="context"
                      label="O que você gostaria de melhorar? (opcional)"
                      error={errors.context}
                    >
                      <Textarea
                        id="context"
                        value={data.context}
                        maxLength={2000}
                        rows={4}
                        aria-invalid={!!errors.context}
                        aria-describedby={errors.context ? 'context-error' : undefined}
                        onChange={(event) => update('context', event.target.value)}
                        placeholder="Conte um desafio ou uma tarefa que ocupa muito tempo."
                      />
                    </Field>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Ao enviar, você solicita o contato da equipe Tactia para preparar sua
                      consultoria. Usaremos os dados informados para entender sua operação e
                      conversar sobre essas oportunidades.
                    </p>
                  </>
                )}
                <div className="hidden" aria-hidden="true">
                  <label htmlFor="website">Website</label>
                  <input
                    id="website"
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={data.website}
                    onChange={(event) => update('website', event.target.value)}
                  />
                </div>
              </fieldset>
              {error && <Alert tone="danger">{error}</Alert>}
              <div className="flex items-center justify-between gap-3 border-t pt-5">
                {step > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      setStep(step - 1);
                      setError('');
                    }}
                  >
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    Voltar
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Vamos por partes.</span>
                )}
                <Button type="submit" loading={pending} disabled={pending} className="min-h-12">
                  {pending ? 'Enviando…' : step === 3 ? 'Enviar e ver horários' : 'Continuar'}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
