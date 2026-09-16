/**
 * Testes dos helpers puros da UI (Etapa 8).
 * Formatação pt-BR e geometria do gráfico.
 */

import { describe, expect, it } from 'vitest';
import { buildChartGeometry, overlayTimeSeries, topNWithOthers } from '../chart';
import {
  briefingNarrative,
  currentMonthRange,
  errorMessage,
  formatCurrency,
  formatDate,
  formatInteger,
  formatPercentDelta,
  formatPeriod,
  metricLabel,
  resolveRangeParam,
} from '../format';

describe('format', () => {
  it('formata moeda em BRL', () => {
    expect(formatCurrency(1234.5).replace(/\u00a0/g, ' ')).toBe('R$ 1.234,50');
    expect(formatCurrency(0).replace(/\u00a0/g, ' ')).toBe('R$ 0,00');
  });

  it('devolve travessão para valores inválidos', () => {
    expect(formatCurrency(Number.NaN)).toBe('—');
    expect(formatInteger(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatDate('não-é-data')).toBe('—');
  });

  it('formata delta com sinal a partir de fração', () => {
    expect(formatPercentDelta(0.154)).toBe('+15,4%');
    expect(formatPercentDelta(-0.5)).toBe('-50%');
    expect(formatPercentDelta(0)).toBe('0%');
  });

  it('formata período no padrão citado pela IA', () => {
    expect(
      formatPeriod({ from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' }),
    ).toBe('01/08/2026 a 01/09/2026');
  });

  it('traduz métricas e códigos de erro conhecidos', () => {
    expect(metricLabel('revenue')).toBe('Receita');
    expect(metricLabel('metrica_desconhecida')).toBe('metrica_desconhecida');
    expect(errorMessage('AI_ERROR')).toContain('IA');
    expect(errorMessage(undefined, 'padrão')).toBe('padrão');
  });

  it('resolve o período da URL com fallback no mês corrente', () => {
    const now = new Date(2026, 7, 15); // 15/08/2026
    const fallback = currentMonthRange(now);

    expect(resolveRangeParam({}, now)).toEqual(fallback);
    // Intervalo invertido é ignorado
    expect(resolveRangeParam({ from: '2026-09-01', to: '2026-08-01' }, now)).toEqual(fallback);
    // Data inválida é ignorada
    expect(resolveRangeParam({ from: 'xx', to: 'yy' }, now)).toEqual(fallback);

    const custom = resolveRangeParam({ from: '2026-01-01', to: '2026-02-01' }, now);
    expect(custom.from.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(custom.to.toISOString().slice(0, 10)).toBe('2026-02-01');
  });
});

describe('buildChartGeometry', () => {
  const points = [
    { key: '2026-08-01', value: 0 },
    { key: '2026-08-02', value: 50 },
    { key: '2026-08-03', value: 100 },
  ];

  it('escala os pontos para o viewBox e mantém min/max/total', () => {
    const geometry = buildChartGeometry(points, { width: 100, height: 100, padding: 0 });

    expect(geometry.min).toBe(0);
    expect(geometry.max).toBe(100);
    expect(geometry.total).toBe(150);
    // primeiro ponto à esquerda e no fundo; último à direita e no topo
    expect(geometry.coords[0]).toMatchObject({ x: 0, y: 100 });
    expect(geometry.coords[2]).toMatchObject({ x: 100, y: 0 });
    expect(geometry.linePath.startsWith('M0,100')).toBe(true);
    expect(geometry.areaPath).toContain('Z');
  });

  it('centraliza séries constantes em vez de dividir por zero', () => {
    const geometry = buildChartGeometry(
      [
        { key: 'a', value: 7 },
        { key: 'b', value: 7 },
      ],
      { width: 100, height: 100, padding: 0 },
    );

    expect(geometry.coords.every((coord) => coord.y === 50)).toBe(true);
  });

  it('trata um único ponto sem gerar área', () => {
    const geometry = buildChartGeometry([{ key: 'a', value: 10 }], {
      width: 100,
      height: 100,
      padding: 0,
    });

    expect(geometry.coords[0]?.x).toBe(50);
    expect(geometry.areaPath).toBe('');
  });

  it('não quebra com série vazia', () => {
    const geometry = buildChartGeometry([]);
    expect(geometry.coords).toHaveLength(0);
    expect(geometry.total).toBe(0);
    expect(geometry.linePath).toBe('');
  });
});

describe('topNWithOthers', () => {
  it('agrupa o restante em Outros', () => {
    const items = [
      { key: 'a', label: 'A', value: 50 },
      { key: 'b', label: 'B', value: 30 },
      { key: 'c', label: 'C', value: 10 },
      { key: 'd', label: 'D', value: 10 },
    ];
    const result = topNWithOthers(items, 2);
    expect(result.map((item) => item.label)).toEqual(['A', 'B', 'Outros']);
    expect(result[2]?.value).toBe(20);
  });
});

describe('overlayTimeSeries', () => {
  it('desloca a série anterior para o eixo atual', () => {
    const day = 24 * 60 * 60 * 1000;
    const current = [{ key: '2026-09-10T00:00:00.000Z', value: 80 }];
    const previous = [{ key: '2026-08-11T00:00:00.000Z', value: 40 }];
    const overlay = overlayTimeSeries(current, previous, 30 * day);
    expect(overlay[0]?.current).toBe(80);
    expect(overlay[0]?.previous).toBe(40);
  });
});

describe('briefingNarrative', () => {
  it('remove a lista de números do briefing', () => {
    const content = [
      '## Semana 2026-09-03 a 2026-09-10',
      '',
      '### Números',
      '- Receita (7d): R$ 261.366',
      '- Vendas (7d): 34',
      '',
      '### O que mais importa',
      '- Ticket médio subiu com mix premium.',
    ].join('\n');
    const narrative = briefingNarrative(content);
    expect(narrative).not.toContain('Receita (7d)');
    expect(narrative).toContain('Ticket médio subiu');
  });
});

