import type { InsightRepository, RecommendationRepository } from '@tactia/database';

type InsightRow = {
  id: string;
  ruleKey: string;
  title: string;
};

type RecommendationTemplate = {
  title: string;
  description: (insight: InsightRow) => string;
  priority: 'low' | 'medium' | 'high';
  actionType?: string;
};

const TEMPLATES: Record<string, RecommendationTemplate> = {
  revenue_drop: {
    title: 'Investigar queda de receita',
    description: (i) =>
      `Foi detectada uma ${i.title.toLowerCase()}. Revise os principais produtos e vendedores para identificar a causa e tomar ação corretiva.`,
    priority: 'high',
    actionType: 'review_revenue',
  },
  revenue_growth: {
    title: 'Capitalizar no crescimento de receita',
    description: (i) =>
      `${i.title}. Identifique os fatores de sucesso e replique-os para manter o momentum.`,
    priority: 'medium',
    actionType: 'analyze_growth',
  },
  product_growth: {
    title: 'Ampliar ações no produto em crescimento',
    description: (i) =>
      `${i.title}. Considere aumentar o estoque ou criar campanhas focadas neste produto.`,
    priority: 'medium',
    actionType: 'review_product',
  },
  product_decline: {
    title: 'Investigar queda de produto',
    description: (i) =>
      `${i.title}. Verifique pricing, disponibilidade e concorrência para este produto.`,
    priority: 'medium',
    actionType: 'review_product',
  },
  inactive_leads: {
    title: 'Retomar contato com leads inativos',
    description: (i) =>
      `${i.title}. Crie uma tarefa de follow-up para cada lead sem atividade recente.`,
    priority: 'high',
    actionType: 'create_task',
  },
  inactive_customers: {
    title: 'Campanha de reativação de clientes',
    description: (i) =>
      `${i.title}. Envie uma comunicação personalizada para reengajar esses clientes.`,
    priority: 'medium',
    actionType: 'send_email',
  },
  seller_performance_deviation: {
    title: 'Suporte ao vendedor com baixa performance',
    description: (i) =>
      `${i.title}. Agende uma reunião de coaching e revise as metas com este vendedor.`,
    priority: 'medium',
    actionType: 'create_task',
  },
  complaint_volume: {
    title: 'Investigar aumento de reclamações',
    description: (i) =>
      `${i.title}. Leia os trechos no chat e priorize os clientes mais afetados.`,
    priority: 'high',
    actionType: 'create_task',
  },
};

export class RecommendationEngine {
  constructor(
    private readonly recommendations: RecommendationRepository,
    private readonly insights: InsightRepository,
  ) {}

  /**
   * For each newly created insight, generate a recommendation if a template exists
   * and there's no pending recommendation already linked to it.
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

      await this.recommendations.create({
        tenantId,
        insightId,
        priority: template.priority,
        title: template.title,
        description: template.description(insight),
        actionType: template.actionType,
      });
    }
  }
}
