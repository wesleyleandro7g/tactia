import type { InfographicSpec, InfographicTemplate } from './schema';
import { INFOGRAPHIC_TEMPLATE_IDS } from './schema';
import type { InfographicTheme } from './tokens';

/** Demo payloads for Ops preview / visual QA. */
export const INFOGRAPHIC_TEMPLATES: InfographicTemplate[] = [...INFOGRAPHIC_TEMPLATE_IDS];

export const INFOGRAPHIC_TEMPLATE_LABELS: Record<InfographicTemplate, string> = {
  kpi_snapshot: 'KPI snapshot',
  comparison: 'Comparação',
  ranking: 'Ranking',
  insight_card: 'Insight card',
  pie_chart: 'Gráfico pizza',
  line_chart: 'Gráfico de linha',
  period_comparison: 'Comparação de período',
  bar_chart: 'Gráfico de barras',
};

export function demoInfographicSpec(
  template: InfographicTemplate,
  theme: InfographicTheme = 'light',
): InfographicSpec {
  switch (template) {
    case 'kpi_snapshot':
      return {
        template: 'kpi_snapshot',
        title: 'Resumo do mês',
        subtitle: 'Janeiro 2026 · Demo Ltda',
        theme,
        payload: {
          items: [
            { label: 'Receita', value: 'R$ 186 mil', delta: 0.128, hint: 'vs. mês anterior' },
            { label: 'Vendas', value: '1.248', delta: 0.062, hint: 'pedidos fechados' },
            { label: 'Ticket médio', value: 'R$ 149', delta: -0.031 },
            { label: 'Novos clientes', value: '87', delta: 0.214 },
          ],
          footnote: 'Dados de demonstração · Tactia',
        },
      };
    case 'comparison':
      return {
        template: 'comparison',
        title: 'Receita vs. mês anterior',
        subtitle: 'Comparativo consolidado',
        theme,
        payload: {
          metricLabel: 'Receita',
          left: { label: 'Este mês', value: 'R$ 186 mil', numeric: 186000 },
          right: { label: 'Mês passado', value: 'R$ 165 mil', numeric: 165000 },
          delta: 0.128,
          footnote: 'Período atual vs. período equivalente anterior',
        },
      };
    case 'ranking':
      return {
        template: 'ranking',
        title: 'Top vendedores',
        subtitle: 'Receita no mês',
        theme,
        payload: {
          metricLabel: 'Receita',
          items: [
            { label: 'Ana Souza', value: 'R$ 48 mil', numeric: 48000 },
            { label: 'Bruno Lima', value: 'R$ 41 mil', numeric: 41000 },
            { label: 'Carla Dias', value: 'R$ 33 mil', numeric: 33000 },
            { label: 'Diego Alves', value: 'R$ 27 mil', numeric: 27000 },
            { label: 'Elena Rocha', value: 'R$ 22 mil', numeric: 22000 },
          ],
          footnote: 'Ranking por receita bruta',
        },
      };
    case 'insight_card':
      return {
        template: 'insight_card',
        title: 'Queda concentrada em 2 produtos',
        subtitle: 'Insight · severidade alta',
        theme,
        payload: {
          highlight: '-R$ 18 mil',
          highlightLabel: 'Impacto estimado',
          bullets: [
            'Produto A respondeu por 62% da queda',
            'Ticket médio estável — o volume caiu',
            'Prioridade: recuperar clientes que compravam A',
          ],
          footnote: 'Exemplo de insight_card para o agente',
        },
      };
    case 'pie_chart':
      return {
        template: 'pie_chart',
        title: 'Receita por canal',
        subtitle: 'Mix do mês · Demo Ltda',
        theme,
        payload: {
          centerLabel: 'Total',
          centerValue: 'R$ 186 mil',
          items: [
            { label: 'Loja física', value: 'R$ 74 mil', share: 0.4 },
            { label: 'E-commerce', value: 'R$ 56 mil', share: 0.3 },
            { label: 'WhatsApp', value: 'R$ 37 mil', share: 0.2 },
            { label: 'Parceiros', value: 'R$ 19 mil', share: 0.1 },
          ],
          footnote: 'Participação na receita bruta',
        },
      };
    case 'line_chart':
      return {
        template: 'line_chart',
        title: 'Receita nas últimas semanas',
        subtitle: 'Tendência diária consolidada',
        theme,
        payload: {
          metricLabel: 'Receita (R$ mil)',
          delta: 0.086,
          points: [
            { label: 'Sem 1', value: '28', numeric: 28 },
            { label: 'Sem 2', value: '31', numeric: 31 },
            { label: 'Sem 3', value: '29', numeric: 29 },
            { label: 'Sem 4', value: '35', numeric: 35 },
            { label: 'Sem 5', value: '38', numeric: 38 },
            { label: 'Sem 6', value: '42', numeric: 42 },
          ],
          footnote: 'Série semanal · valores em milhares',
        },
      };
    case 'period_comparison':
      return {
        template: 'period_comparison',
        title: 'Janeiro vs. dezembro',
        subtitle: 'Indicadores lado a lado',
        theme,
        payload: {
          leftLabel: 'Janeiro',
          rightLabel: 'Dezembro',
          metrics: [
            {
              label: 'Receita',
              left: 'R$ 186 mil',
              right: 'R$ 165 mil',
              leftNumeric: 186000,
              rightNumeric: 165000,
              delta: 0.128,
            },
            {
              label: 'Pedidos',
              left: '1.248',
              right: '1.175',
              leftNumeric: 1248,
              rightNumeric: 1175,
              delta: 0.062,
            },
            {
              label: 'Ticket médio',
              left: 'R$ 149',
              right: 'R$ 154',
              leftNumeric: 149,
              rightNumeric: 154,
              delta: -0.032,
            },
            {
              label: 'Margem bruta',
              left: '42%',
              right: '39%',
              leftNumeric: 42,
              rightNumeric: 39,
              delta: 0.077,
            },
          ],
          footnote: 'Comparação de período equivalente',
        },
      };
    case 'bar_chart':
      return {
        template: 'bar_chart',
        title: 'Receita por categoria',
        subtitle: 'Top categorias do mês',
        theme,
        payload: {
          metricLabel: 'Receita',
          items: [
            { label: 'Eletrônicos', value: 'R$ 62 mil', numeric: 62000 },
            { label: 'Moda', value: 'R$ 48 mil', numeric: 48000 },
            { label: 'Casa', value: 'R$ 35 mil', numeric: 35000 },
            { label: 'Beleza', value: 'R$ 24 mil', numeric: 24000 },
            { label: 'Esporte', value: 'R$ 17 mil', numeric: 17000 },
          ],
          footnote: 'Categorias com maior faturamento',
        },
      };
  }
}
