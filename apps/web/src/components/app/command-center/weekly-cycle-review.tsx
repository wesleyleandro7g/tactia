import Link from 'next/link';
import type { CycleReview } from '@tactia/domain';
import { Alert } from '@/components/ui/alert';
import { Badge, statusTone } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { OutcomeReview } from './outcome-review';
import type { MeasurementDefinitionView } from './types';

const PLAN_STATUS: Record<string, string> = {
  draft: 'Em preparação',
  active: 'Em acompanhamento',
  paused: 'Pausado',
  completed: 'Concluído',
  closed: 'Encerrado',
};

const DECISION_LABEL: Record<string, string> = {
  continue: 'Continuar',
  adjust: 'Ajustar',
  close: 'Encerrar',
  approved: 'Aprovado',
  rejected: 'Recusado',
};

const EXECUTION_STATUS: Record<string, string> = {
  pending: 'Na fila',
  awaiting_approval: 'Aguardando decisão',
  approved: 'Aprovado',
  running: 'Em execução',
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};

const GAP_STATUS: Record<string, string> = {
  new: 'Nova',
  in_progress: 'Em tratamento',
  waiting_source: 'Aguardando fonte',
  waiting_response: 'Aguardando resposta',
};

const GAP_IMPACT: Record<string, string> = {
  critical: 'Crítico',
  high: 'Alto',
  medium: 'Médio',
  low: 'Baixo',
};

function formatDay(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(value));
}

function resultsHref(from: string, to: string) {
  return `/results?from=${from}&to=${to}`;
}

function shiftInclusiveWindow(from: string, to: string, direction: -1 | 1) {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const endExclusive = Date.parse(`${to}T00:00:00.000Z`) + 86_400_000;
  const duration = endExclusive - start;
  const nextStart = new Date(start + direction * duration);
  const nextEndInclusive = new Date(endExclusive + direction * duration - 1);
  return {
    from: nextStart.toISOString().slice(0, 10),
    to: nextEndInclusive.toISOString().slice(0, 10),
  };
}

function observationDefinition(item: CycleReview['observations'][number]): MeasurementDefinitionView {
  return {
    id: item.definitionId,
    metricKey: item.metricKey,
    indicator: item.indicator,
    unit: item.unit,
    baseline: item.baseline,
    target: item.target,
    windowFrom: item.windowFrom,
    windowTo: item.windowTo,
    attribution: item.attribution,
    sources: item.sources,
    version: item.version,
    reviews: item.reviews,
  };
}

export function WeeklyCycleReview({ review }: { review: CycleReview }) {
  const previous = shiftInclusiveWindow(review.periodInclusive.from, review.periodInclusive.to, -1);
  const next = shiftInclusiveWindow(review.periodInclusive.from, review.periodInclusive.to, 1);
  const empty = !review.inProgress.length
    && !review.decisions.length
    && !review.executions.length
    && !review.gaps.length
    && !review.observations.length;

  return (
    <section aria-labelledby="cycle-review-title" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="cycle-review-title" className="font-display text-2xl tracking-tight">
            Revisão da janela
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDay(review.period.from)} a {formatDay(review.periodInclusive.to)}.
            Os eixos permanecem independentes: executar não marca objetivo atingido nem impacto causal.
          </p>
        </div>
        <nav aria-label="Janelas da revisão" className="flex flex-wrap gap-3 text-sm">
          <Link href={resultsHref(previous.from, previous.to)} className="text-primary underline-offset-4 hover:underline">
            Janela anterior
          </Link>
          <Link href={resultsHref(next.from, next.to)} className="text-primary underline-offset-4 hover:underline">
            Próxima janela
          </Link>
        </nav>
      </div>

      {empty ? (
        <EmptyState
          title="Nada observado nesta janela"
          description="A Tactia continua acompanhando as fontes. Ausência de cobertura não aparece como zero comercial, e nenhum check-in é necessário."
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card aria-labelledby="cycle-in-progress">
          <CardHeader>
            <div>
              <CardTitle id="cycle-in-progress">Em andamento</CardTitle>
              <CardDescription>Estado do plano e do objetivo, sem inferir resultado.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {review.inProgress.length ? (
              <ul className="flex flex-col gap-4">
                {review.inProgress.map((plan) => (
                  <li key={plan.planId} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/operations/plans/${plan.planId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                        {plan.title}
                      </Link>
                      <Badge tone={statusTone(plan.status)}>{PLAN_STATUS[plan.status] ?? plan.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Objetivo:{' '}
                      <Link href={`/objectives/${plan.goalId}`} className="text-primary underline-offset-4 hover:underline">
                        {plan.goalTitle ?? 'Objetivo preparado'}
                      </Link>
                      {' · '}
                      {plan.goalStatus === 'active' ? 'objetivo em curso' : plan.goalStatus}
                      {plan.nextReviewAt
                        ? ` · próxima revisão ${new Date(plan.nextReviewAt).toLocaleDateString('pt-BR')}`
                        : ''}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum plano estava em andamento nesta janela.</p>
            )}
          </CardContent>
        </Card>

        <Card aria-labelledby="cycle-decisions">
          <CardHeader>
            <div>
              <CardTitle id="cycle-decisions">Decisões</CardTitle>
              <CardDescription>O que foi decidido, sem o conteúdo pessoal da autorização.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {review.decisions.length ? (
              <ul className="flex flex-col gap-4">
                {review.decisions.map((decision) => (
                  <li key={`${decision.kind}-${decision.id}`} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusTone(decision.choice)}>
                        {DECISION_LABEL[decision.choice] ?? decision.choice}
                      </Badge>
                      <Link href={`/operations/plans/${decision.planId}`} className="text-primary underline-offset-4 hover:underline">
                        {decision.planTitle}
                      </Link>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {decision.kind === 'plan_review' ? 'Revisão do resultado' : 'Autorização da ação'}
                      {decision.fromVersion && decision.toVersion
                        ? ` · versões ${decision.fromVersion} → ${decision.toVersion}`
                        : ''}
                      {' · '}
                      {new Date(decision.createdAt).toLocaleString('pt-BR')}
                    </p>
                    {decision.reason ? <p className="text-sm text-muted-foreground">{decision.reason}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma decisão foi registrada nesta janela.</p>
            )}
          </CardContent>
        </Card>

        <Card aria-labelledby="cycle-executions">
          <CardHeader>
            <div>
              <CardTitle id="cycle-executions">Execução</CardTitle>
              <CardDescription>O que o executor existente fez. Concluir a ação não fecha o objetivo.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {review.executions.length ? (
              <ul className="flex flex-col gap-4">
                {review.executions.map((execution) => (
                  <li key={execution.id} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusTone(execution.status)}>
                        {EXECUTION_STATUS[execution.status] ?? execution.status}
                      </Badge>
                      <span className="font-medium">{execution.actionName}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      <Link href={`/operations/plans/${execution.planId}`} className="text-primary underline-offset-4 hover:underline">
                        {execution.planTitle}
                      </Link>
                      {` · ${execution.stepTitle}`}
                      {execution.finishedAt
                        ? ` · finalizada em ${new Date(execution.finishedAt).toLocaleString('pt-BR')}`
                        : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Plano {PLAN_STATUS[execution.planStatus] ?? execution.planStatus}. A execução é um eixo próprio.
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma execução vinculada ao plano ocorreu nesta janela.</p>
            )}
            <Alert tone="info" title="Eixos independentes">
              Uma execução concluída registra o efeito operacional. O objetivo e o resultado comercial continuam nos seus eixos.
            </Alert>
          </CardContent>
        </Card>

        <Card aria-labelledby="cycle-gaps">
          <CardHeader>
            <div>
              <CardTitle id="cycle-gaps">Lacunas</CardTitle>
              <CardDescription>O que ainda impede observação confiável. A reconciliação fica com a Tactia.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {review.gaps.length ? (
              <ul className="flex flex-col gap-4">
                {review.gaps.map((gap) => (
                  <li key={gap.id} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={gap.impact === 'critical' || gap.impact === 'high' ? 'warning' : 'neutral'}>
                        {GAP_IMPACT[gap.impact] ?? gap.impact}
                      </Badge>
                      <span className="font-medium">{gap.subject}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{gap.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      {GAP_STATUS[gap.status] ?? gap.status}
                      {gap.planId && gap.planTitle ? (
                        <>
                          {' · '}
                          <Link href={`/operations/plans/${gap.planId}`} className="text-primary underline-offset-4 hover:underline">
                            {gap.planTitle}
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma lacuna permanece aberta para esta empresa.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="cycle-observations" className="flex flex-col gap-4">
        <div>
          <h3 id="cycle-observations" className="font-display text-xl tracking-tight">Resultado observado</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Variação medida na janela do plano. Sem cobertura o valor permanece indisponível, nunca zero comercial.
          </p>
        </div>
        {review.observations.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {review.observations.map((item) => (
              <div key={item.definitionId} className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  Plano:{' '}
                  <Link href={`/operations/plans/${item.planId}`} className="text-primary underline-offset-4 hover:underline">
                    {item.planTitle}
                  </Link>
                  {` · objetivo ${item.goalStatus === 'active' ? 'em curso' : item.goalStatus}`}
                </p>
                <OutcomeReview definition={observationDefinition(item)} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nenhuma medição nesta janela"
            description="Quando houver cobertura, o observado aparece com definição, unidade e limite de atribuição. Sem dados, o valor continua vazio."
          />
        )}
      </section>
    </section>
  );
}

export function WeeklyCycleExcerpt({ review }: { review: CycleReview }) {
  const href = resultsHref(review.periodInclusive.from, review.periodInclusive.to);
  const observation = review.observations[0];
  const summary = [
    review.inProgress.length ? `${review.inProgress.length} em andamento` : null,
    review.decisions.length ? `${review.decisions.length} decidido${review.decisions.length === 1 ? '' : 's'}` : null,
    review.executions.length ? `${review.executions.length} execução${review.executions.length === 1 ? '' : 'ões'}` : null,
    review.gaps.length ? `${review.gaps.length} lacuna${review.gaps.length === 1 ? '' : 's'}` : null,
    observation
      ? observation.availability === 'ready'
        ? 'resultado observado'
        : 'medição ainda sem cobertura'
      : 'sem medição na janela',
  ].filter((item): item is string => item !== null);

  return (
    <Card aria-labelledby="today-cycle-review">
      <CardHeader>
        <div>
          <CardTitle id="today-cycle-review">Acompanhamento da janela</CardTitle>
          <CardDescription>
            {formatDay(review.period.from)} a {formatDay(review.periodInclusive.to)}.
          </CardDescription>
        </div>
        <Link href={href} className="text-sm text-primary underline-offset-4 hover:underline">
          Ver revisão consolidada
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {summary.length ? summary.join(' · ') : 'Nada observado nesta janela. A Tactia continua nas fontes, sem pedir atualização.'}
        </p>
        <Alert tone="info">
          Executar uma ação não marca o objetivo como atingido. O resultado comercial só aparece quando a medição tem cobertura.
        </Alert>
      </CardContent>
    </Card>
  );
}
