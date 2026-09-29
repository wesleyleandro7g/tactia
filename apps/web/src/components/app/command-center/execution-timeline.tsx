import { Alert } from '@/components/ui/alert';
import { Badge, statusTone } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { PlanView } from './types';

const STEP_STATUS: Record<string, string> = { pending: 'Aguardando evidência', running: 'Em andamento', completed: 'Concluída', blocked: 'Bloqueada', failed: 'Falhou' };

export function ExecutionTimeline({ plan }: { plan: PlanView }) {
  return (
    <Card aria-labelledby={`execution-${plan.id}`}>
      <CardHeader>
        <div><CardTitle id={`execution-${plan.id}`}>{plan.title}</CardTitle><CardDescription>Responsável: {plan.responsibleLabel ?? 'Identificado no processo existente'}{plan.nextReviewAt ? ` · próxima revisão ${new Date(plan.nextReviewAt).toLocaleDateString('pt-BR')}` : ''}</CardDescription></div>
        <Badge tone={statusTone(plan.status)}>{plan.status === 'active' ? 'Em acompanhamento' : plan.status}</Badge>
      </CardHeader>
      <CardContent>
        <ol className="relative flex flex-col gap-5 border-l border-border pl-5">{plan.steps.map((step) => {
          const execution = step.executions.at(-1)?.actionExecution;
          const status = execution?.status ?? step.status;
          return <li key={step.id} className="relative before:absolute before:-left-[1.55rem] before:top-1 before:size-2 before:rounded-full before:bg-primary"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{step.position}. {step.title}</h3><Badge tone={statusTone(status)}>{STEP_STATUS[status] ?? status}</Badge></div>{step.description ? <p className="mt-1 text-sm text-muted-foreground">{step.description}</p> : null}{execution ? <p className="mt-1 text-xs text-muted-foreground">{execution.action.name} · criada em {new Date(execution.createdAt).toLocaleString('pt-BR')}{execution.finishedAt ? ` · finalizada em ${new Date(execution.finishedAt).toLocaleString('pt-BR')}` : ''}</p> : <p className="mt-1 text-xs text-muted-foreground">Acompanhamento pelas fontes; nenhuma atualização manual é necessária.</p>}{execution?.error ? <Alert className="mt-2" tone="danger">{execution.error}</Alert> : null}</li>;
        })}</ol>
        {plan.gaps.length ? <Alert className="mt-5" tone="warning" title="Informação em reconciliação">{plan.gaps[0]?.reason} A equipe Tactia é responsável pelo próximo passo.</Alert> : null}
      </CardContent>
    </Card>
  );
}
