import { describe, expect, it } from 'vitest';
import { loosenThreshold, RULE_THRESHOLD_KEY } from '../services/threshold-calibrator';
import { DEFAULT_THRESHOLDS } from '@tactia/intelligence';

describe('loosenThreshold', () => {
  it('raises a positive threshold by 20% and caps at 2× default', () => {
    expect(loosenThreshold(0.12, 0.12)).toBeCloseTo(0.144, 6);
    expect(loosenThreshold(0.22, 0.12)).toBeCloseTo(0.24, 6);
  });

  it('makes a negative threshold more extreme and caps at 2× default', () => {
    expect(loosenThreshold(-0.15, -0.15)).toBeCloseTo(-0.18, 6);
    expect(loosenThreshold(-0.28, -0.15)).toBeCloseTo(-0.3, 6);
  });
});

describe('RULE_THRESHOLD_KEY', () => {
  it('maps known rules to existing default thresholds', () => {
    for (const key of Object.values(RULE_THRESHOLD_KEY)) {
      expect(DEFAULT_THRESHOLDS[key]).toEqual(expect.any(Number));
    }
  });
});
