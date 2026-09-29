import { describe, expect, it } from 'vitest';
import {
  clarificationResponseIsClear,
  evaluateClarificationPolicy,
} from '../services/evidence-clarification-service';

const policy = {
  enabled: true,
  startHour: 9,
  endHour: 18,
  maxPerDay: 2,
  cooldownHours: 24,
  weekdays: [1, 2, 3, 4, 5],
  timezone: 'America/Sao_Paulo',
};

// 2026-09-29 is a Tuesday. 15:00 UTC = 12:00 in São Paulo.
const businessHours = new Date('2026-09-29T15:00:00Z');

describe('evaluateClarificationPolicy', () => {
  it('requires the company to opt in', () => {
    expect(
      evaluateClarificationPolicy({
        policy: { ...policy, enabled: false },
        sentLast24Hours: 0,
        lastSentAt: null,
        now: businessHours,
      }),
    ).toMatchObject({ allowed: false });
  });

  it('allows a contact inside the configured window', () => {
    expect(
      evaluateClarificationPolicy({
        policy,
        sentLast24Hours: 0,
        lastSentAt: null,
        now: businessHours,
      }),
    ).toEqual({ allowed: true });
  });

  it('blocks outside the allowed hours', () => {
    expect(
      evaluateClarificationPolicy({
        policy,
        sentLast24Hours: 0,
        lastSentAt: null,
        // 03:00 UTC = 00:00 in São Paulo.
        now: new Date('2026-09-29T03:00:00Z'),
      }),
    ).toMatchObject({ allowed: false });
  });

  it('blocks on a weekday outside the policy', () => {
    expect(
      evaluateClarificationPolicy({
        policy,
        sentLast24Hours: 0,
        lastSentAt: null,
        // Sunday 2026-09-27.
        now: new Date('2026-09-27T15:00:00Z'),
      }),
    ).toMatchObject({ allowed: false });
  });

  it('respects the daily budget per person', () => {
    expect(
      evaluateClarificationPolicy({
        policy,
        sentLast24Hours: 2,
        lastSentAt: null,
        now: businessHours,
      }),
    ).toMatchObject({ allowed: false });
  });

  it('respects the cooldown since the last contact', () => {
    expect(
      evaluateClarificationPolicy({
        policy,
        sentLast24Hours: 0,
        lastSentAt: new Date('2026-09-29T12:00:00Z'),
        now: businessHours,
      }),
    ).toMatchObject({ allowed: false });
  });
});

describe('clarificationResponseIsClear', () => {
  it('treats a direct answer as clear', () => {
    expect(clarificationResponseIsClear('Sim, falei com o cliente ontem.')).toBe(true);
  });

  it('never treats hesitation as a confirmation', () => {
    for (const reply of ['não sei', 'talvez', 'vou verificar', 'acho que sim', 'depois te falo']) {
      expect(clarificationResponseIsClear(reply)).toBe(false);
    }
  });
});
