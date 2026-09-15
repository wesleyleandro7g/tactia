import { cn } from '@/lib/utils';

export type WizardStepMeta = {
  id: string;
  label: string;
};

export function WizardStepper({
  steps,
  currentIndex,
}: {
  steps: WizardStepMeta[];
  currentIndex: number;
}) {
  return (
    <nav aria-label="Etapas da configuração" className="mb-6">
      <p className="mb-3 font-mono text-xs text-muted-foreground md:hidden">
        Passo {currentIndex + 1} de {steps.length} — {steps[currentIndex]?.label}
      </p>
      <ol className="hidden gap-2 md:flex">
        {steps.map((step, index) => {
          const done = index < currentIndex;
          const current = index === currentIndex;
          return (
            <li
              key={step.id}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3 py-2 font-mono text-xs',
                current && 'border-primary bg-accent-soft text-foreground',
                done && 'border-success/40 bg-success-soft text-foreground',
                !current && !done && 'border-border bg-card text-muted-foreground',
              )}
              aria-current={current ? 'step' : undefined}
            >
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
                  current && 'border-primary',
                  done && 'border-success bg-success text-background',
                  !current && !done && 'border-border',
                )}
                aria-hidden
              >
                {done ? '✓' : index + 1}
              </span>
              <span className="truncate uppercase tracking-wide">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
