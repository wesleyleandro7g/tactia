'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MessageSquare, MoreHorizontal, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Badge, severityTone } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/feedback';
import {
  DISMISS_REASON_LABELS,
  ENTITY_TYPE_LABELS,
  INSIGHT_TYPE_LABELS,
  SEVERITY_LABELS,
  errorMessage,
  formatCurrency,
  formatDate,
  formatInteger,
  formatPercentDelta,
  metricLabel,
  ruleLabel,
} from '@/lib/format';
import { cn } from '@/lib/utils';

type EvidenceItem = {
  key?: string;
  value?: number;
  period?: { from: string; to: string };
  comparison?: { change?: number };
};

type DriverContributorView = {
  key: string;
  label: string;
  delta: number;
  share: number;
  status?: 'new' | 'lost' | 'changed';
};

type DriversView = {
  metric?: string;
  delta?: number;
  change?: number;
  byDimension?: Array<{ dimension: string; contributors: DriverContributorView[] }>;
  summary?: string;
};

export type InsightView = {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  ruleKey: string;
  periodFrom: Date | string;
  periodTo: Date | string;
  evidence: unknown;
  recommendations: Array<{ id: string; status: string }>;
  // Insights v2 (opcionais para compatibilidade com registros antigos)
  entityType?: string | null;
  entityId?: string | null;
  impactAmount?: number | string | null;
  confidence?: number | null;
  score?: number;
  drivers?: unknown;
};

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;

/** Métricas de contagem não são dinheiro — evita "R$ 12 leads". */
const COUNT_METRICS = new Set([
  'sales_count',
  'customer_count',
  'new_customers',
  'inactive_leads_count',
  'inactive_customers_count',
  'churn_risk_customers',
  'hot_leads_stalled',
  'unanswered_interactions',
  'negative_interactions',
  'complaint_count',
  'data_age_hours',
  'insights',
]);

const RATE_METRICS = new Set(['gross_margin', 'cancellation_rate', 'discount_share']);

function formatEvidence(item: EvidenceItem): string | null {
  if (!item.key || typeof item.value !== 'number') return null;

  const label = metricLabel(item.key);
  const value = item.key.endsWith('_growth')
    ? formatPercentDelta(item.value)
    : RATE_METRICS.has(item.key)
      ? `${(item.value * 100).toFixed(1).replace('.', ',')}%`
      : COUNT_METRICS.has(item.key)
        ? formatInteger(item.value)
        : formatCurrency(item.value);

  const change = item.comparison?.change;
  const comparison = typeof change === 'number' ? ` (${formatPercentDelta(change)})` : '';
  return `${label}: ${value}${comparison}`;
}

/** Top 3 contribuidores da variação (todas as dimensões, ordenados por |delta|). */
function topDrivers(drivers: unknown): DriverContributorView[] {
  if (!drivers || typeof drivers !== 'object') return [];
  const view = drivers as DriversView;
  const all = (view.byDimension ?? []).flatMap((dimension) =>
    dimension.contributors.map((contributor) => ({ ...contributor, dimension: dimension.dimension })),
  );
  return all
    .filter((item) => typeof item.delta === 'number' && item.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pergunta pronta para o chat, com o contexto do insight. */
function chatQuestion(insight: InsightView): string {
  const period = `${formatDate(insight.periodFrom)} a ${formatDate(insight.periodTo)}`;
  return `Sobre o insight "${insight.title}" (${period}): explique a causa com dados, o impacto em R$ e o que eu deveria fazer.`;
}

/**
 * Insights agrupados por severidade (spec §57). A severidade aparece como badge
 * com texto — nunca só por cor — e a evidência determinística fica visível.
 * Insights v2: impacto em R$, top 3 drivers, "Perguntar no chat" e dispensa com motivo.
 */
export function InsightList({ insights }: { insights: InsightView[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = insights.filter((insight) => !hidden.has(insight.id));

  if (visible.length === 0) {
    return (
      <EmptyState
        title="Nenhum insight aberto"
        description="Rode a análise para avaliar as regras determinísticas sobre os dados importados."
      />
    );
  }

  const groups = SEVERITY_ORDER.map((severity) => ({
    severity,
    items: visible
      .filter((insight) => insight.severity === severity)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.severity} aria-labelledby={`severity-${group.severity}`}>
          <h3 id={`severity-${group.severity}`} className="mb-2 text-sm font-medium text-muted-foreground">
            {SEVERITY_LABELS[group.severity] ?? group.severity} · {group.items.length}
          </h3>
          <ul className="flex flex-col gap-3">
            {group.items.map((insight) => (
              <li key={insight.id}>
                <InsightCard
                  insight={insight}
                  onHidden={() => setHidden((current) => new Set(current).add(insight.id))}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function InsightCard({ insight, onHidden }: { insight: InsightView; onHidden: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vote, setVote] = useState<boolean | null>(null);

  const evidence = Array.isArray(insight.evidence)
    ? (insight.evidence as EvidenceItem[])
        .map(formatEvidence)
        .filter((line): line is string => line !== null)
        .slice(0, 3)
    : [];
  const drivers = topDrivers(insight.drivers);
  const impact = toNumber(insight.impactAmount);
  const pendingRecommendations = insight.recommendations.filter(
    (recommendation) => recommendation.status === 'pending',
  ).length;

  async function update(status: 'acknowledged' | 'dismissed', dismissReason?: string) {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/v1/insights/${insight.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, ...(dismissReason ? { dismissReason } : {}) }),
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(body?.error?.code));
      return;
    }
    onHidden();
    router.refresh();
  }

  async function feedback(useful: boolean) {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/v1/insights/${insight.id}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ useful }),
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(errorMessage(body?.error?.code));
      return;
    }
    setVote(useful);
  }

  return (
    <Card className="p-4">
      <CardHeader className="mb-2">
        <div className="min-w-0">
          <CardTitle className="text-base">{insight.title}</CardTitle>
          <CardDescription>{insight.description}</CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {impact != null && impact > 0 ? (
            <Badge tone="neutral" className="tabular" title="Impacto estimado no período">
              {formatCurrency(impact)}
            </Badge>
          ) : null}
          <Badge tone={severityTone(insight.severity)}>
            {SEVERITY_LABELS[insight.severity] ?? insight.severity}
          </Badge>
        </div>
      </CardHeader>

      {evidence.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {evidence.map((line) => (
            <li key={line} className="tabular">
              {line}
            </li>
          ))}
        </ul>
      ) : null}

      {drivers.length > 0 ? (
        <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground">Principais causas</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs">
            {drivers.map((driver) => (
              <li key={`${driver.key}-${driver.label}`} className="flex justify-between gap-3">
                <span className="truncate">
                  {driver.label}
                  {driver.status === 'new' ? ' (novo)' : driver.status === 'lost' ? ' (perdido)' : ''}
                </span>
                <span className="tabular shrink-0 text-muted-foreground">
                  {driver.delta > 0 ? '+' : ''}
                  {formatCurrency(driver.delta)}
                  {Number.isFinite(driver.share) && Math.abs(driver.share) >= 0.01
                    ? ` · ${Math.round(Math.abs(driver.share) * 100)}%`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-subtle">
          {INSIGHT_TYPE_LABELS[insight.type] ?? insight.type} · {ruleLabel(insight.ruleKey)}
          {insight.entityType ? ` · ${ENTITY_TYPE_LABELS[insight.entityType] ?? insight.entityType}` : ''}
          {' · '}
          {formatDate(insight.periodFrom)} a {formatDate(insight.periodTo)}
          {pendingRecommendations > 0
            ? ` · ${pendingRecommendations} recomendação(ões) pendente(s)`
            : ''}
        </p>

        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={pending}
            aria-label="Insight útil"
            aria-pressed={vote === true}
            onClick={() => void feedback(true)}
          >
            <ThumbsUp className={vote === true ? 'size-3.5 text-primary' : 'size-3.5'} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={pending}
            aria-label="Insight não útil"
            aria-pressed={vote === false}
            onClick={() => void feedback(false)}
          >
            <ThumbsDown className={vote === false ? 'size-3.5 text-primary' : 'size-3.5'} />
          </Button>
          <Link
            href={`/chat?q=${encodeURIComponent(chatQuestion(insight))}`}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'h-7 gap-1.5 px-2 text-xs',
            )}
          >
            <MessageSquare className="size-3.5" aria-hidden="true" />
            Perguntar no chat
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  disabled={pending}
                  aria-label="Mais ações do insight"
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void update('acknowledged')}>
                Marcar como visto
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Dispensar porque…</DropdownMenuLabel>
              {Object.entries(DISMISS_REASON_LABELS).map(([reason, label]) => (
                <DropdownMenuItem key={reason} onSelect={() => void update('dismissed', reason)}>
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
