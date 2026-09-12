import { describe, expect, it } from 'vitest';
import {
  buildClaimAllowlist,
  canonicalizeNumber,
  collectAllowedFromValues,
  extractNumberTokens,
  unsourcedNumbers,
} from '../ai-safety/numbers';
import { collectAllowedNumbers, type BriefingFactSet } from '../services/briefing-service';

const FACTS: BriefingFactSet = {
  period: { from: '2026-01-01', to: '2026-01-08' },
  currency: 'BRL',
  metrics: [
    { key: 'revenue', label: 'Receita', value: 1500, formatted: 'R$ 1.500', change: 0.1 },
  ],
  insights: [],
};

describe('ai-safety numbers', () => {
  it('E14: briefing unsourcedNumbers still rejects invented percent', () => {
    const allowed = collectAllowedNumbers(FACTS);
    const offenders = unsourcedNumbers('A receita cresceu 99% na semana.', allowed);
    expect(offenders.some((token) => token.includes('99'))).toBe(true);
    expect(unsourcedNumbers('Receita de R$ 1.500, alta de 10%.', allowed)).toEqual([]);
  });

  it('E16: document excerpt is ignored by the claim allowlist', () => {
    const allowed = buildClaimAllowlist([], [
      {
        metric: 'documents',
        tool: 'search_documents',
        excerpt: 'A receita no PDF é R$ 10.000.000',
        label: 'Política',
      },
    ]);
    expect(unsourcedNumbers('Vendemos R$ 10.000.000.', allowed).length).toBeGreaterThan(0);
  });

  it('canonicalizes percents as p: and money as n:', () => {
    expect(canonicalizeNumber('15%')).toBe('p:15');
    expect(canonicalizeNumber('R$ 1.500')).toBe('n:1500');
    expect(extractNumberTokens('1500')).toEqual(['1500']);
    expect(extractNumberTokens('R$ 1.500')).toEqual(['R$ 1.500']);
    expect([...collectAllowedFromValues([1500, 15], ['15%'])]).toEqual(
      expect.arrayContaining(['n:1500', 'n:15', 'p:15']),
    );
  });
});
