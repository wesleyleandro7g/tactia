import { Prisma } from '@tactia/database';
import { formatInteger, plural } from '../format';
import type { DetectedEvent, MetricResult } from '../types';
import type { Rule } from './types';

export const complaintVolumeRule: Rule = {
  key: 'complaint_volume',
  async evaluate(ctx) {
    const result = await ctx.metrics.calculate('complaint_count', {
      tenantId: ctx.tenantId,
      period: ctx.period,
      withComparison: true,
    });

    const current = result.value;
    const previous = result.comparison?.value ?? 0;
    const change = result.comparison?.change ?? 0;

    if (current === 0) return [];
    if (previous === 0 && current < 3) return [];
    if (previous > 0 && change < ctx.thresholds.complaintGrowth) return [];

    // Top topics give the "what are they complaining about".
    const rows = await ctx.db.interaction.findMany({
      where: {
        tenantId: ctx.tenantId,
        intent: 'complaint',
        occurredAt: { gte: ctx.period.from, lt: ctx.period.to },
      },
      select: { topics: true, customerId: true },
    });
    const topicCounts = new Map<string, number>();
    const customers = new Set<string>();
    for (const row of rows) {
      if (row.customerId) customers.add(row.customerId);
      for (const topic of row.topics) topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
    const topTopics = [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([topic, count]) => `${topic} (${count})`);

    const evidence: MetricResult = result;
    return [
      {
        ruleKey: 'complaint_volume',
        type: 'warning',
        severity: current >= 10 || change >= 1 ? 'high' : 'medium',
        title:
          previous === 0
            ? `${current} ${plural(current, 'reclamação', 'reclamações')} no período`
            : `Reclamações ${Math.round(change * 100)}% acima do período anterior`,
        description:
          (previous === 0
            ? `Foram classificadas ${current} ${plural(current, 'interação', 'interações')} como reclamação no período`
            : `As reclamações passaram de ${previous} para ${current} em relação ao período anterior`) +
          (customers.size > 0 ? `, vindas de ${customers.size} ${plural(customers.size, 'cliente', 'clientes')}` : '') +
          (topTopics.length > 0 ? `. Temas mais citados: ${topTopics.join(', ')}.` : '.'),
        evidence: [evidence],
        periodFrom: ctx.period.from,
        periodTo: ctx.period.to,
        confidence: 0.8,
      },
    ];
  },
};

type UnansweredRow = { count: string; customers: string; oldest: Date | null };

/**
 * Inbound messages from identified customers with no outbound reply within
 * `unansweredHours` — and still unanswered now.
 */
export const unansweredInteractionsRule: Rule = {
  key: 'unanswered_interactions',
  async evaluate(ctx) {
    const hours = ctx.thresholds.unansweredHours;
    const deadline = new Date(Date.now() - hours * 60 * 60 * 1000);
    const rows = await ctx.db.$queryRaw<UnansweredRow[]>(Prisma.sql`
      SELECT COUNT(*)::text AS count,
             COUNT(DISTINCT i.customer_id)::text AS customers,
             MIN(i.occurred_at) AS oldest
      FROM interactions i
      WHERE i.tenant_id = ${ctx.tenantId}::uuid
        AND i.direction = 'inbound'
        AND i.customer_id IS NOT NULL
        AND i.occurred_at >= ${ctx.period.from}
        AND i.occurred_at < ${deadline}
        AND NOT EXISTS (
          SELECT 1 FROM interactions o
          WHERE o.tenant_id = i.tenant_id
            AND o.customer_id = i.customer_id
            AND o.direction = 'outbound'
            AND o.occurred_at > i.occurred_at
        )
    `);
    const row = rows[0];
    const count = row ? parseInt(row.count, 10) : 0;
    if (count === 0) return [];
    const customers = row ? parseInt(row.customers, 10) : 0;

    const event: DetectedEvent = {
      ruleKey: 'unanswered_interactions',
      type: 'warning',
      severity: count >= 10 ? 'high' : 'medium',
      title: `${formatInteger(count)} ${plural(count, 'mensagem de cliente sem resposta', 'mensagens de clientes sem resposta')}`,
      description:
        `${formatInteger(count)} ${plural(count, 'mensagem recebida', 'mensagens recebidas')} de ${customers} ${plural(customers, 'cliente', 'clientes')} ` +
        `${plural(count, 'está', 'estão')} há mais de ${hours}h sem nenhuma resposta registrada` +
        (row?.oldest ? ` (a mais antiga é de ${row.oldest.toLocaleDateString('pt-BR')})` : '') +
        '. Tempo de resposta é o principal driver de satisfação e conversão.',
      evidence: [
        {
          key: 'unanswered_interactions',
          value: count,
          period: { from: ctx.period.from.toISOString(), to: deadline.toISOString() },
        },
      ],
      periodFrom: ctx.period.from,
      periodTo: ctx.period.to,
      confidence: 0.7,
    };
    return [event];
  },
};
