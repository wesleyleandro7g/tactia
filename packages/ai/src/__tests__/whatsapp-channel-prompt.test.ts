/**
 * WhatsApp channel block in the system prompt: injected only when a channel
 * context is provided, leaving the web-chat prompt byte-for-byte identical.
 */

import { describe, expect, it } from 'vitest';
import type { AiContext } from '../context-builder';
import { buildSystemPrompt } from '../system-prompt';

const PERIOD = { from: '2025-01-01T00:00:00.000Z', to: '2025-02-01T00:00:00.000Z' };

function context(): AiContext {
  return {
    company: {
      id: 'tenant-1',
      name: 'Demo Ltda',
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
      today: '2025-01-31',
      weekday: 'sexta-feira',
      daysLeftInMonth: 1,
      daysElapsedInMonth: 31,
    },
    period: PERIOD,
    trailing30: [],
    trailingPeriod: PERIOD,
    goals: [],
    facts: [],
    playbooks: [],
    briefing: null,
    metrics: [{ key: 'revenue', value: 1000, change: -0.5, direction: 'down' }],
    insights: [],
    sources: [{ metric: 'revenue', period: PERIOD, value: 1000, tool: 'context' }],
  };
}

const TOOLS = ['get_revenue', 'send_email'];

describe('buildSystemPrompt — WhatsApp channel block', () => {
  it('is absent when no channel is provided (web chat unchanged)', () => {
    const prompt = buildSystemPrompt(context(), TOOLS);
    expect(prompt).not.toContain('## Canal: WhatsApp');
  });

  it('is identical with an undefined channel', () => {
    const a = buildSystemPrompt(context(), TOOLS);
    const b = buildSystemPrompt(context(), TOOLS, undefined);
    expect(a).toBe(b);
  });

  it('injects tone, instructions, company context and contact treatment', () => {
    const prompt = buildSystemPrompt(context(), TOOLS, {
      tone: 'Formal e objetivo',
      instructions: 'Confirme antes de enviar e-mails.',
      companyContext: 'Loja de calçados com 3 filiais.',
      contactName: 'João Silva',
      contactRole: 'Gerente Comercial',
    });
    expect(prompt).toContain('## Canal: WhatsApp');
    expect(prompt).toContain('João Silva, Gerente Comercial');
    expect(prompt).toContain('Formal e objetivo');
    expect(prompt).toContain('Confirme antes de enviar e-mails.');
    expect(prompt).toContain('Loja de calçados com 3 filiais.');
  });

  it('handles a channel with only a contact name', () => {
    const prompt = buildSystemPrompt(context(), TOOLS, { contactName: 'Maria' });
    expect(prompt).toContain('## Canal: WhatsApp');
    expect(prompt).toContain('Maria');
    expect(prompt).not.toContain('Tom desejado');
  });
});
