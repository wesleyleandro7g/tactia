import type { InfographicSpec, InfographicTemplate } from './schema';
import type { InfographicTheme } from './tokens';

/** Demo payloads for Ops preview / visual QA. */
export const INFOGRAPHIC_TEMPLATES: InfographicTemplate[] = [
  'kpi_snapshot',
  'comparison',
  'ranking',
  'insight_card',
];

export const INFOGRAPHIC_TEMPLATE_LABELS: Record<InfographicTemplate, string> = {
  kpi_snapshot: 'KPI snapshot',
  comparison: 'Comparação',
  ranking: 'Ranking',
  insight_card: 'Insight card',
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
  }
}
