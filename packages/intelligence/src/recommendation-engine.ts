import type { InsightRepository, RecommendationRepository } from '@tactia/database';
import { formatMoney, joinNames } from './format';
import type { DriverContributor, Drivers } from './types';

type InsightRow = {
  id: string;
  ruleKey: string;
  title: string;
  description: string;
  entityType: string | null;
  entityId: string | null;
  impactAmount: { toNumber(): number } | number | null;
  drivers: unknown;
};

type Priority = 'low' | 'medium' | 'high';

/** Proposal payload compatible with the `propose_action` tool / Execution Engine. */
export type SuggestedAction = {
  actionType: 'create_task' | 'send_email';
  input: Record<string, unknown>;
  reason: string;
};

export type RecommendationMetadata = {
  estimatedImpact: number | null;
  entity: { type: string; id: string } | null;
  /** Top contributors from the insight drivers (for the UI / the assistant). */
  contributors: Array<{ key: string; label: string; delta: number; share: number }>;
  suggestedAction: SuggestedAction | null;
};

type TemplateContext = {
  insight: InsightRow;
  impact: number | null;
  contributors: DriverContributor[];
  currency: string;
};

type RecommendationTemplate = {
  title: (ctx: TemplateContext) => string;
  description: (ctx: TemplateContext) => string;
  priority: Priority | ((ctx: TemplateContext) => Priority);
  actionType?: string;
  suggestedAction?: (ctx: TemplateContext) => SuggestedAction | null;
};

function impactOf(insight: InsightRow): number | null {
  const value = insight.impactAmount;
  if (value == null) return null;
  return typeof value === 'number' ? value : value.toNumber();
}

function contributorsOf(insight: InsightRow, dimension?: string): DriverContributor[] {
  const drivers = insight.drivers as Drivers | null | undefined;
  if (!drivers?.byDimension) return [];
  const dims = dimension
    ? drivers.byDimension.filter((d) => d.dimension === dimension)
    : [...drivers.byDimension].sort((a, b) => b.explainedShare - a.explainedShare);
  return dims[0]?.contributors ?? [];
}

function names(contributors: DriverContributor[], max = 3): string {
  return joinNames(contributors.slice(0, max).map((c) => c.label));
}

function taskFor(
  title: string,
  description: string,
  extra: Record<string, unknown> = {},
  reason = title,
): SuggestedAction {
  return { actionType: 'create_task', input: { title, description, ...extra }, reason };
}

const impactText = (ctx: TemplateContext, prefix: string) =>
  ctx.impact != null && ctx.impact > 0 ? ` ${prefix} ${formatMoney(ctx.impact, ctx.currency)}.` : '';

const TEMPLATES: Record<string, RecommendationTemplate> = {
  revenue_drop: {
    title: () => 'Investigar a queda de receita nos principais responsáveis',
    description: (ctx) => {
      const customers = contributorsOf(ctx.insight, 'customer').filter((c) => c.delta < 0);
      const products = contributorsOf(ctx.insight, 'product').filter((c) => c.delta < 0);
      const parts = ['Comece pelos maiores contribuintes da queda.'];
      if (customers.length > 0) parts.push(`Clientes: ${names(customers)} — verifique se pararam de comprar ou reduziram volume.`);
      if (products.length > 0) parts.push(`Produtos: ${names(products)} — cheque disponibilidade, preço e concorrência.`);
      parts.push(`Receita perdida${impactText(ctx, 'em relação ao período anterior:') || ': ver evidência.'}`);
      return parts.join(' ');
    },
    priority: 'high',
    actionType: 'create_task',
    suggestedAction: (ctx) => {
      const customers = contributorsOf(ctx.insight, 'customer').filter((c) => c.delta < 0);
      if (customers.length === 0) return null;
      return taskFor(
        `Contatar ${names(customers)} sobre queda de compras`,
        `Estes clientes explicam a maior parte da queda de receita. Entender o motivo e propor recompra.`,
        customers.length === 1 ? { customerId: customers[0]!.key } : {},
      );
    },
  },
  revenue_growth: {
    title: () => 'Replicar o que puxou o crescimento',
    description: (ctx) => {
      const top = contributorsOf(ctx.insight).filter((c) => c.delta > 0);
      return (
        (top.length > 0
          ? `${names(top)} explicam a maior parte do crescimento. `
          : '') +
        'Identifique o que mudou (campanha, vendedor, preço, mix) e replique nos demais.' +
        impactText(ctx, 'Receita adicional:')
      );
    },
    priority: 'medium',
    actionType: 'analyze_growth',
  },
  revenue_concentration: {
    title: () => 'Reduzir dependência do maior cliente',
    description: (ctx) =>
      `${ctx.insight.title}. Fortaleça a relação com esse cliente (contrato, acompanhamento) e acelere a carteira: os próximos clientes ` +
      `precisam crescer para diluir o risco.${impactText(ctx, 'Receita concentrada:')}`,
    priority: 'medium',
    actionType: 'create_task',
    suggestedAction: (ctx) =>
      ctx.insight.entityId
        ? taskFor(
            'Plano de retenção para o maior cliente',
            'Cliente concentra parcela crítica da receita. Agendar reunião de relacionamento e revisar condições.',
            { customerId: ctx.insight.entityId },
          )
        : null,
  },
  product_growth: {
    title: (ctx) => `Ampliar ações em ${ctx.insight.title.split(' cresceu')[0]}`,
    description: (ctx) =>
      `${ctx.insight.title}. Garanta estoque e destaque o produto em campanhas e no discurso da equipe.${impactText(ctx, 'Receita adicional:')}`,
    priority: 'medium',
    actionType: 'review_product',
  },
  product_decline: {
    title: (ctx) => `Investigar queda de ${(ctx.insight.title.split(' caiu')[0] ?? '').split(' parou')[0] ?? ctx.insight.title}`,
    description: (ctx) =>
      `${ctx.insight.title}. Verifique disponibilidade, preço e concorrência; ouça vendedores e clientes sobre o produto.${impactText(ctx, 'Receita perdida:')}`,
    priority: (ctx) => (ctx.impact != null && ctx.impact >= 5000 ? 'high' : 'medium'),
    actionType: 'review_product',
    suggestedAction: (ctx) =>
      taskFor(
        `Investigar queda do produto: ${ctx.insight.title}`,
        'Checar estoque, preço praticado, concorrência e feedback de clientes.',
      ),
  },
  product_decline_with_complaints: {
    title: () => 'Ler as reclamações e corrigir a causa antes de vender mais',
    description: (ctx) =>
      `${ctx.insight.title}. A queda vem acompanhada de reclamações: leia os relatos, identifique o problema (qualidade, entrega, preço) ` +
      `e responda aos clientes afetados.${impactText(ctx, 'Receita perdida:')}`,
    priority: 'high',
    actionType: 'create_task',
    suggestedAction: (ctx) =>
      taskFor(
        `Analisar reclamações do produto em queda`,
        `${ctx.insight.title}. Revisar reclamações e definir ação corretiva.`,
      ),
  },
  customer_churn_risk: {
    title: () => 'Contatar os clientes em risco antes que parem de comprar',
    description: (ctx) => {
      const top = contributorsOf(ctx.insight, 'customer');
      return (
        `Priorize ${names(top)}: são recorrentes e estão fora da cadência habitual. Um contato pessoal com oferta ` +
        `de recompra costuma recuperar parte deles.${impactText(ctx, 'Receita esperada em risco:')}`
      );
    },
    priority: (ctx) => (ctx.impact != null && ctx.impact >= 10000 ? 'high' : 'medium'),
    actionType: 'create_task',
    suggestedAction: (ctx) => {
      const top = contributorsOf(ctx.insight, 'customer');
      if (top.length === 0) return null;
      return taskFor(
        `Follow-up com clientes em risco de churn: ${names(top)}`,
        'Clientes recorrentes fora da cadência de compra. Ligar/mandar mensagem e oferecer recompra.',
        top.length === 1 ? { customerId: top[0]!.key } : {},
      );
    },
  },
  churn_risk_with_open_complaint: {
    title: (ctx) => `Resolver a reclamação de ${ctx.insight.title.split(':')[0]} hoje`,
    description: (ctx) =>
      `${ctx.insight.description} Trate a reclamação primeiro e só depois fale em recompra.`,
    priority: 'high',
    actionType: 'create_task',
    suggestedAction: (ctx) =>
      ctx.insight.entityId
        ? taskFor(
            `Contato urgente: ${ctx.insight.title.split(':')[0]}`,
            'Cliente reclamou e parou de comprar. Resolver a reclamação e retomar relacionamento.',
            { customerId: ctx.insight.entityId },
          )
        : null,
  },
  inactive_leads: {
    title: () => 'Retomar contato com leads parados',
    description: (ctx) =>
      `${ctx.insight.title}. Crie uma tarefa de follow-up por lead, começando pelos de maior score.${impactText(ctx, 'Potencial estimado:')}`,
    priority: 'high',
    actionType: 'create_task',
    suggestedAction: (ctx) =>
      taskFor('Follow-up dos leads sem atividade', ctx.insight.description),
  },
  hot_lead_stalled: {
    title: () => 'Contatar os leads quentes hoje',
    description: (ctx) => `${ctx.insight.description}${impactText(ctx, 'Potencial estimado:')}`,
    priority: 'high',
    actionType: 'create_task',
    suggestedAction: (ctx) =>
      taskFor('Contatar leads quentes parados', ctx.insight.description),
  },
  inactive_customers: {
    title: () => 'Campanha de reativação de clientes',
    description: (ctx) => `${ctx.insight.title}. Envie uma comunicação personalizada para reengajar esses clientes.`,
    priority: 'medium',
    actionType: 'send_email',
  },
  seller_performance_deviation: {
    title: (ctx) => `Apoiar ${ctx.insight.title.split(' está')[0]} com coaching e revisão de carteira`,
    description: (ctx) =>
      `${ctx.insight.description} Entenda se é carteira, pipeline ou abordagem antes de cobrar meta.${impactText(ctx, 'Gap para a média:')}`,
    priority: 'medium',
    actionType: 'create_task',
    suggestedAction: (ctx) =>
      ctx.insight.entityId
        ? taskFor(
            `Reunião de acompanhamento: ${ctx.insight.title.split(' está')[0]}`,
            ctx.insight.description,
            { sellerId: ctx.insight.entityId },
          )
        : null,
  },
  seller_high_discount_low_margin: {
    title: () => 'Revisar política de desconto do vendedor',
    description: (ctx) =>
      `${ctx.insight.description} Defina alçada de desconto e acompanhe a margem por venda.${impactText(ctx, 'Desconto acima da média:')}`,
    priority: 'medium',
    actionType: 'create_task',
    suggestedAction: (ctx) =>
      ctx.insight.entityId
        ? taskFor('Revisar alçada de desconto', ctx.insight.description, { sellerId: ctx.insight.entityId })
        : null,
  },
  margin_drop: {
    title: () => 'Revisar preços, descontos e custos dos produtos que perderam margem',
    description: (ctx) => {
      const products = contributorsOf(ctx.insight, 'product').filter((c) => c.delta < 0);
      return (
        (products.length > 0 ? `Produtos que mais perderam margem: ${names(products)}. ` : '') +
        'Compare preço praticado vs. tabela e custo atualizado do fornecedor.' +
        impactText(ctx, 'Margem perdida:')
      );
    },
    priority: 'high',
    actionType: 'review_pricing',
  },
  discount_share: {
    title: () => 'Definir alçadas de desconto e acompanhar semanalmente',
    description: (ctx) => `${ctx.insight.description}`,
    priority: 'medium',
    actionType: 'review_pricing',
  },
  cancellation_rate: {
    title: () => 'Investigar motivos de cancelamento e reembolso',
    description: (ctx) =>
      `${ctx.insight.description} Liste os motivos por venda cancelada; se concentrarem em um produto ou vendedor, trate a causa.`,
    priority: 'high',
    actionType: 'create_task',
    suggestedAction: (ctx) => taskFor('Levantar motivos de cancelamento', ctx.insight.description),
  },
  complaint_volume: {
    title: () => 'Investigar aumento de reclamações',
    description: (ctx) => `${ctx.insight.description} Leia os trechos no chat e priorize os clientes mais afetados.`,
    priority: 'high',
    actionType: 'create_task',
    suggestedAction: (ctx) => taskFor('Tratar reclamações do período', ctx.insight.description),
  },
  unanswered_interactions: {
    title: () => 'Responder as mensagens pendentes hoje',
    description: (ctx) => `${ctx.insight.description} Defina um responsável e um SLA de resposta.`,
    priority: 'high',
    actionType: 'create_task',
    suggestedAction: (ctx) => taskFor('Responder mensagens de clientes sem resposta', ctx.insight.description),
  },
  stale_data: {
    title: () => 'Sincronizar a fonte de dados',
    description: (ctx) => `${ctx.insight.description} Rode a sincronização ou verifique a credencial da fonte.`,
    priority: 'low',
    actionType: 'sync_data_source',
  },
};

export class RecommendationEngine {
  constructor(
    private readonly recommendations: RecommendationRepository,
    private readonly insights: InsightRepository,
    private readonly currency = 'BRL',
  ) {}

  /**
   * For each newly created insight, generate a recommendation if a template
   * exists and there's no pending recommendation already linked to it.
   */
  async generateForInsights(tenantId: string, insightIds: string[]): Promise<void> {
    for (const insightId of insightIds) {
      const insight = await this.insights.findById({ tenantId, id: insightId });
      if (!insight) continue;

      const template = TEMPLATES[insight.ruleKey];
      if (!template) continue;

      // Deduplication: don't create a second pending recommendation for the same insight
      const existing = await this.recommendations.findPendingByInsight({ insightId });
      if (existing) continue;

      const ctx: TemplateContext = {
        insight,
        impact: impactOf(insight),
        contributors: contributorsOf(insight),
        currency: this.currency,
      };
      const priority = typeof template.priority === 'function' ? template.priority(ctx) : template.priority;
      const suggestedAction = template.suggestedAction?.(ctx) ?? null;
      const metadata: RecommendationMetadata = {
        estimatedImpact: ctx.impact,
        entity: insight.entityType && insight.entityId ? { type: insight.entityType, id: insight.entityId } : null,
        contributors: ctx.contributors.slice(0, 5).map((c) => ({
          key: c.key,
          label: c.label,
          delta: c.delta,
          share: c.share,
        })),
        suggestedAction,
      };

      await this.recommendations.create({
        tenantId,
        insightId,
        priority,
        title: template.title(ctx),
        description: template.description(ctx),
        actionType: template.actionType,
        metadata,
      });
    }
  }
}
