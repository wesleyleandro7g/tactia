'use client';

import { cn } from '@/lib/cn';

export type WizardStep = { id: string; label: string };

/**
 * Stepper do onboarding. Os passos não são clicáveis: avançar exige passar pela
 * validação de cada etapa (evita pular o teste de conexão, por exemplo).
 */
export function WizardStepper({
  steps,
  current,
  errorAt,
}: {
  steps: WizardStep[];
  /** Índice do passo atual (0-based). */
  current: number;
  errorAt?: number | null;
}) {
  return (
    <>
      <ol className="hidden items-center gap-2 md:flex" aria-label="Progresso do onboarding">
        {steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          const failed = errorAt === index;

          return (
            <li key={step.id} className="flex items-center gap-2">
              <span
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-full border px-3 py-1 text-xs',
                  failed && 'border-danger/40 bg-danger-soft text-danger',
                  !failed && active && 'border-accent/40 bg-accent-soft text-accent',
                  !failed && done && 'border-success/40 bg-success-soft text-success',
                  !failed && !active && !done && 'border-border text-muted-foreground',
                )}
              >
                <span aria-hidden="true">{done && !failed ? '✓' : index + 1}</span>
                {step.label}
              </span>
              {index < steps.length - 1 ? (
                <span aria-hidden="true" className="h-px w-4 bg-border" />
              ) : null}
            </li>
          );
        })}
      </ol>

      <p className="text-sm text-muted-foreground md:hidden">
        Passo {current + 1} de {steps.length} — {steps[current]?.label}
      </p>
    </>
  );
}
