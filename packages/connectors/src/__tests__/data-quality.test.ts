import { describe, expect, it } from 'vitest';
import { runDataQualityChecks } from '../data-quality';

describe('runDataQualityChecks — interaction', () => {
  it('rejects rows without body or occurred_at', () => {
    const result = runDataQualityChecks('interaction', [
      { external_id: '1', body: 'ok', occurred_at: '2025-01-01' },
      { external_id: '2', body: '', occurred_at: '2025-01-01' },
      { external_id: '3', body: 'ok', occurred_at: 'not-a-date' },
    ]);
    expect(result.invalidRecords).toBe(2);
    expect(result.errors.some((issue) => issue.rule === 'interaction_without_body')).toBe(true);
    expect(result.errors.some((issue) => issue.rule === 'interaction_invalid_date')).toBe(true);
  });
});
