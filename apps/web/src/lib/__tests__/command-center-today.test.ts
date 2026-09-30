import { describe, expect, it } from 'vitest';
import { AVAILABILITY_LABEL } from '@/components/app/command-center/types';
import {
  buildTodayBriefingView,
  deriveTodayAvailability,
  evidenceLines,
  toTodaySnapshot,
} from '../command-center-today-view';

describe('deriveTodayAvailability', () => {
  it('marca empty sem objetivo e error sem realizado', () => {
    expect(deriveTodayAvailability({ hasObjective: false, hasProgress: false, freshness: null })).toBe('empty');
    expect(deriveTodayAvailability({ hasObjective: true, hasProgress: false, freshness: null })).toBe('error');
  });

  it('distingue cobertura parcial, desatualizada e pronta', () => {
    expect(deriveTodayAvailability({
      hasObjective: true,
      hasProgress: true,
      freshness: { sources: [], staleCount: 0 },
    })).toBe('partial');
    expect(deriveTodayAvailability({
      hasObjective: true,
      hasProgress: true,
      freshness: { sources: [{ lastSyncAt: '2026-09-30T12:00:00.000Z' }], staleCount: 1 },
    })).toBe('stale');
    expect(deriveTodayAvailability({
      hasObjective: true,
      hasProgress: true,
      freshness: { sources: [{ lastSyncAt: '2026-09-30T12:00:00.000Z' }], staleCount: 0 },
    })).toBe('ready');
  });
});

describe('toTodaySnapshot', () => {
  it('leva a atenção da primeira prioridade e o destino do chat', () => {
    const briefing = buildTodayBriefingView({
      objectives: [{
        id: 'obj-1',
        title: 'Receita do trimestre',
        status: 'active',
        metricKey: 'revenue',
        target: 100,
        baselineValue: 10,
        periodType: 'quarter',
        periodStart: '2026-07-01',
        version: 1,
      }],
      plans: [],
      recommendations: [{
        id: 'rec-1',
        title: 'Revisar desconto médio',
        description: 'O desconto subiu sem evidência de mix.',
        insight: { severity: 'high', evidence: [{ key: 'discount_total', value: 1200 }] },
      }],
      progress: [{ id: 'obj-1', achieved: 40 }],
      freshness: { sources: [{ lastSyncAt: '2026-09-30T12:00:00.000Z' }], staleCount: 0 },
      cycleReview: null,
    });
    const snapshot = toTodaySnapshot(briefing);
    expect(snapshot.availability).toBe('ready');
    expect(snapshot.objectiveTitle).toBe('Receita do trimestre');
    expect(snapshot.attention).toBe('Revisar desconto médio');
    expect(snapshot.chatHref).toBe('/chat?contextType=objective&contextId=obj-1');
    expect(AVAILABILITY_LABEL[snapshot.availability]).toBe('Atualizado');
  });
});

describe('evidenceLines', () => {
  it('ignora evidência sem chave ou valor útil', () => {
    expect(evidenceLines(null)).toEqual([]);
    expect(evidenceLines([{ key: 'revenue', value: 10 }])).toEqual(['Receita: 10']);
  });
});
