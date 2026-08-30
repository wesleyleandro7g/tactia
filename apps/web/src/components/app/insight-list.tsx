import { Badge, severityTone } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import {
  INSIGHT_TYPE_LABELS,
  SEVERITY_LABELS,
  formatCurrency,
  formatDate,
  formatInteger,
  formatPercentDelta,
  metricLabel,
} from '@/lib/format';

type EvidenceItem = {
  key?: string;
  value?: number;
  period?: { from: string; to: string };
  comparison?: { change?: number };
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
};

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;

/** Métricas de contagem não são dinheiro — evita "R$ 12 leads". */
const COUNT_METRICS = new Set([
  'sales_count',
  'customer_count',
  'inactive_leads_count',
  'inactive_customers_count',
  'insights',
]);

function formatEvidence(item: EvidenceItem): string | null {
  if (!item.key || typeof item.value !== 'number') return null;

  const label = metricLabel(item.key);
  const value = item.key.endsWith('_growth')
    ? formatPercentDelta(item.value)
    : COUNT_METRICS.has(item.key)
      ? formatInteger(item.value)
      : formatCurrency(item.value);

  const change = item.comparison?.change;
  const comparison = typeof change === 'number' ? ` (${formatPercentDelta(change)})` : '';
  return `${label}: ${value}${comparison}`;
}

/**
 * Insights agrupados por severidade (spec §57). A severidade aparece como badge
 * com texto — nunca só por cor — e a evidência determinística fica visível.
 */
export function InsightList({ insights }: { insights: InsightView[] }) {
  if (insights.length === 0) {
    return (
      <EmptyState
        title="Nenhum insight aberto"
        description="Rode a análise para avaliar as regras determinísticas sobre os dados importados."
      />
    );
  }

  const groups = SEVERITY_ORDER.map((severity) => ({
    severity,
    items: insights.filter((insight) => insight.severity === severity),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.severity} aria-labelledby={`severity-${group.severity}`}>
          <h3 id={`severity-${group.severity}`} className="mb-2 text-sm font-medium text-muted">
            {SEVERITY_LABELS[group.severity] ?? group.severity} · {group.items.length}
          </h3>
          <ul className="flex flex-col gap-3">
            {group.items.map((insight) => {
              const evidence = Array.isArray(insight.evidence)
                ? (insight.evidence as EvidenceItem[])
                    .map(formatEvidence)
                    .filter((line): line is string => line !== null)
                    .slice(0, 3)
                : [];
              const pending = insight.recommendations.filter(
                (recommendation) => recommendation.status === 'pending',
              ).length;

              return (
                <li key={insight.id}>
                  <Card className="p-4">
                    <CardHeader className="mb-2">
                      <div>
                        <CardTitle className="text-base">{insight.title}</CardTitle>
                        <CardDescription>{insight.description}</CardDescription>
                      </div>
                      <Badge tone={severityTone(insight.severity)}>
                        {SEVERITY_LABELS[insight.severity] ?? insight.severity}
                      </Badge>
                    </CardHeader>

                    {evidence.length > 0 ? (
                      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                        {evidence.map((line) => (
                          <li key={line} className="tabular">
                            {line}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <p className="mt-2 text-xs text-subtle">
                      {INSIGHT_TYPE_LABELS[insight.type] ?? insight.type} · regra {insight.ruleKey} ·{' '}
                      {formatDate(insight.periodFrom)} a {formatDate(insight.periodTo)}
                      {pending > 0 ? ` · ${pending} recomendação(ões) pendente(s)` : ''}
                    </p>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
