import { describe, expect, it } from 'vitest';
import { acquisitionLeadSchema, consultationLeadSchema } from './acquisition';

const valid = {
  submissionId: 'efc819e5-45ce-4789-a751-c34a8edddc35',
  name: ' Ana Silva ',
  email: ' ANA@EXAMPLE.COM ',
  whatsapp: '+55 (11) 99999-1234',
  company: 'Empresa',
  segment: 'Serviços',
  employeeRange: '2–10',
  revenueRange: 'Prefiro não informar',
  systems: ['Planilhas', 'CRM'],
};
describe('acquisition form validation', () => {
  it('normalizes contact and accepts optional phone and undisclosed revenue', () => {
    expect(acquisitionLeadSchema.parse(valid)).toMatchObject({
      name: 'Ana Silva',
      email: 'ana@example.com',
      whatsapp: '5511999991234',
    });
    expect(acquisitionLeadSchema.parse({ ...valid, phone: '' }).phone).toBeUndefined();
  });
  it.each([
    { systems: [] },
    { systems: ['Nenhum', 'CRM'] },
    { systems: ['CRM', 'CRM'] },
    { email: 'invalid' },
    { whatsapp: 'abc123' },
    { whatsapp: '123' },
    { segment: 'Outros' },
    { context: 'a'.repeat(2001) },
    { company: '' },
  ])('rejects invalid answers %j', (input) => {
    expect(acquisitionLeadSchema.safeParse({ ...valid, ...input }).success).toBe(false);
  });
  it('accepts other segment and a single none answer', () => {
    expect(
      acquisitionLeadSchema.safeParse({
        ...valid,
        segment: 'Outros',
        segmentOther: 'Logística',
        systems: ['Nenhum'],
      }).success,
    ).toBe(true);
  });
});

describe('short consultation form', () => {
  const {
    segment: _segment,
    employeeRange: _employees,
    revenueRange: _revenue,
    systems: _systems,
    ...short
  } = valid;
  it('accepts contact without qualification and normalizes it', () => {
    expect(consultationLeadSchema.parse(short)).toMatchObject({
      name: 'Ana Silva',
      email: 'ana@example.com',
      whatsapp: '5511999991234',
    });
    expect(acquisitionLeadSchema.safeParse(short).success).toBe(false);
  });
  it('bounds campaign attribution and strips untrusted source/status fields', () => {
    expect(
      consultationLeadSchema.parse({
        ...short,
        source: 'web',
        status: 'scheduled',
        attribution: { utm_source: ' google ', unknown: 'ignored' },
      }),
    ).toMatchObject({ attribution: { utm_source: 'google' } });
    const parsed = consultationLeadSchema.parse({ ...short, source: 'web', status: 'scheduled' });
    expect(parsed).not.toHaveProperty('source');
    expect(parsed).not.toHaveProperty('status');
    expect(
      consultationLeadSchema.safeParse({ ...short, attribution: { utm_campaign: 'x'.repeat(201) } })
        .success,
    ).toBe(false);
  });
  it.each([
    { email: 'invalid' },
    { whatsapp: '123' },
    { name: '' },
    { company: '' },
    { context: 'x'.repeat(2001) },
    { submissionId: 'invalid' },
  ])('rejects invalid short submissions %j', (patch) => {
    expect(consultationLeadSchema.safeParse({ ...short, ...patch }).success).toBe(false);
  });
});
