import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createId } from '@tactia/shared';
import { MockLLMAdapter } from '../adapters/mock-llm-adapter';
import type { AiContext } from '../context-builder';
import { Orchestrator } from '../orchestrator';
import { ToolRegistry, defineTool } from '../tool-registry';
import type { ChatStreamEvent, ToolContext } from '../types';

const PERIOD = { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' };

function context(withRevenue = true): AiContext {
  return {
    company: { id: 'tenant-1', name: 'Demo', currency: 'BRL', timezone: 'America/Sao_Paulo', today: '2026-09-29', weekday: 'terça-feira', daysLeftInMonth: 2, daysElapsedInMonth: 29 },
    period: PERIOD,
    trailing30: [],
    trailingPeriod: PERIOD,
    metrics: withRevenue ? [{ key: 'revenue', value: 1500 }] : [],
    insights: [], goals: [], facts: [], playbooks: [], briefing: null,
    sources: withRevenue ? [{ metric: 'revenue', period: PERIOD, value: 1500, tool: 'context' }] : [],
  };
}

const ctx = (): ToolContext => ({
  requestId: createId(), tenantId: 'tenant-1', userId: 'user-1', role: 'owner', ip: null,
});

const revenueTool = defineTool({
  name: 'get_revenue', description: 'Receita confirmada.', inputSchema: z.object({}), recoverySafe: true,
  async execute() {
    return {
      data: { value: 1600 },
      sources: [{ metric: 'revenue', period: PERIOD, value: 1600, tool: 'get_revenue' }],
    };
  },
});

function make(script: ConstructorParameters<typeof MockLLMAdapter>[0]['script'], withRevenue = true, tools = new ToolRegistry([revenueTool])) {
  const llm = new MockLLMAdapter({ script });
  const orchestrator = new Orchestrator({
    llm, tools, contextBuilder: { build: async () => context(withRevenue) },
  });
  return { llm, orchestrator };
}

describe('answer recovery', () => {
  it('consults another read source and returns the verified revision', async () => {
    const { orchestrator, llm } = make([
      { text: 'A receita foi R$ 999.999.' },
      { toolCalls: [{ name: 'get_revenue' }] },
      { text: 'A receita confirmada foi R$ 1.600.' },
    ]);

    const answer = await orchestrator.run({ ctx: ctx(), question: 'Quanto vendemos?' });

    expect(answer.content).toContain('1.600');
    expect(answer.content).not.toContain('999.999');
    expect(answer.resolution).toBe('recovered');
    expect(answer.recoveryAttempts).toBe(2);
    expect(answer.toolCalls.map((call) => call.name)).toEqual(['get_revenue']);
    expect(llm.requests[1]?.tools?.map((tool) => tool.name)).toEqual(['get_revenue']);
    expect(llm.requests[1]?.system).toContain('999.999');
  });

  it('uses a fresh read result for the partial answer when the model still fails', async () => {
    const { orchestrator } = make([
      { text: 'A receita foi R$ 999.999.' },
      { toolCalls: [{ name: 'get_revenue' }] },
      { text: 'Não consigo cruzar os dados.' },
    ]);
    const answer = await orchestrator.run({ ctx: ctx(), question: 'Qual foi a receita?' });
    expect(answer.resolution).toBe('partial');
    expect(answer.content).toMatch(/R\$\s+1\.600/);
    expect(answer.content).not.toContain('1.500');
  });

  it('publishes only the validated text in streaming mode', async () => {
    const { orchestrator } = make([
      { text: 'A receita foi R$ 999.999.' },
      { toolCalls: [{ name: 'get_revenue' }] },
      { text: 'A receita confirmada foi R$ 1.600.' },
    ]);
    const events: ChatStreamEvent[] = [];
    for await (const event of orchestrator.stream({ ctx: ctx(), question: 'Quanto vendemos?' })) events.push(event);

    expect(events.filter((event) => event.type === 'text').map((event) => event.type === 'text' ? event.delta : '').join('')).toBe('A receita confirmada foi R$ 1.600.');
    expect(JSON.stringify(events)).not.toContain('999.999');
    expect(events.at(-1)).toMatchObject({ type: 'done', answer: { resolution: 'recovered' } });
  });

  it('keeps a useful grounded partial answer when revisions fail', async () => {
    const { orchestrator } = make([{ text: 'R$ 999.999.' }]);
    const answer = await orchestrator.run({ ctx: ctx(), question: 'Quanto vendemos?' });
    expect(answer.resolution).toBe('partial');
    expect(answer.content).toContain('01/09/2026');
    expect(answer.content).toMatch(/R\$\s+1\.500/);
    expect(answer.content).not.toContain('999.999');
    expect(answer.content).not.toContain('Não consegui cruzar');
  });

  it('replaces a generic inability response with a grounded answer', async () => {
    const { orchestrator } = make([{ text: 'Não consigo cruzar os dados agora.' }]);
    const answer = await orchestrator.run({ ctx: ctx(), question: 'Quanto vendemos?' });
    expect(answer.resolution).toBe('partial');
    expect(answer.content).toMatch(/R\$\s+1\.500/);
    expect(answer.content).not.toContain('Não consigo');
  });

  it('returns recorded objectives with their scope and period after an invalid draft', async () => {
    const goal = {
      id: 'goal-1', metricKey: 'sales_count', scope: 'company', scopeLabel: 'Loja principal',
      period: PERIOD, target: 100, achieved: 72, progress: 0.72,
      requiredDailyPace: 14, projected: null, onTrack: true, periodEnd: PERIOD.to,
    };
    const rateGoal = {
      ...goal, id: 'goal-2', metricKey: 'cancellation_rate', scopeLabel: null,
      target: 0.05, achieved: 0.04, progress: 0.8, requiredDailyPace: 0.01,
    };
    const base = context();
    const llm = new MockLLMAdapter({ script: [{ text: 'A meta é 999.999 vendas.' }] });
    const orchestrator = new Orchestrator({
      llm,
      tools: new ToolRegistry([]),
      contextBuilder: { build: async () => ({
        ...base,
        goals: [goal, rateGoal],
        sources: [...base.sources, { metric: 'goal_progress', period: PERIOD, value: 72, tool: 'context', refId: 'goal-1' }],
      }) },
    });
    const answer = await orchestrator.run({ ctx: ctx(), question: 'Quais são nossos objetivos?' });
    expect(answer.resolution).toBe('partial');
    expect(answer.content).toContain('Loja principal');
    expect(answer.content).toContain('01/09/2026 a 01/10/2026');
    expect(answer.content).toContain('objetivo 100, realizado 72');
    expect(answer.content).toContain('objetivo 5%, realizado 4%');
    expect(answer.content).not.toContain('999.999');
  });

  it('asks a contextual question when there is no numeric evidence', async () => {
    const { orchestrator } = make([{ text: 'Vendemos R$ 999.999.' }], false);
    const answer = await orchestrator.run({ ctx: ctx(), question: 'Quanto vendemos?' });
    expect(answer.resolution).toBe('clarification');
    expect(answer.content).toContain('vendas');
    expect(answer.content).toContain('?');
    expect(answer.content).not.toContain('999.999');
  });

  it('never executes a mutating tool during recovery', async () => {
    let sends = 0;
    const send = defineTool({
      name: 'send_email', description: 'Envia e-mail.', inputSchema: z.object({}),
      async execute() { sends += 1; return { data: { sent: true }, sources: [] }; },
    });
    const { orchestrator } = make([
      { text: 'A receita foi R$ 999.999.' },
      { toolCalls: [{ name: 'send_email' }] },
      { text: 'A receita confirmada foi R$ 1.500.' },
    ], true, new ToolRegistry([send]));

    const answer = await orchestrator.run({ ctx: ctx(), question: 'Quanto vendemos?' });
    expect(sends).toBe(0);
    expect(answer.toolCalls).toHaveLength(0);
    expect(answer.content).toContain('1.500');
  });

  it('limits extra consultations to two batches and four calls', async () => {
    let calls = 0;
    const read = defineTool({
      name: 'get_revenue', description: 'Receita.', inputSchema: z.object({ variant: z.number() }), recoverySafe: true,
      async execute() {
        calls += 1;
        return { data: { value: 1500 }, sources: [{ metric: 'revenue', period: PERIOD, value: 1500, tool: 'get_revenue' }] };
      },
    });
    const variants = (numbers: number[]) => numbers.map((variant) => ({ name: 'get_revenue', input: { variant } }));
    const { orchestrator } = make([
      { text: 'Receita de R$ 999.999.' },
      { toolCalls: variants([1, 2, 3]) },
      { toolCalls: variants([4, 5, 6]) },
      { text: 'A receita confirmada é R$ 1.500.' },
    ], true, new ToolRegistry([read]));
    const answer = await orchestrator.run({ ctx: ctx(), question: 'Receita?' });
    expect(calls).toBe(4);
    expect(answer.toolCalls).toHaveLength(4);
    expect(answer.content).toContain('1.500');
  });

  it('does not repeat the same read call during recovery', async () => {
    let calls = 0;
    const read = defineTool({
      name: 'get_revenue', description: 'Receita.', inputSchema: z.object({}), recoverySafe: true,
      async execute() {
        calls += 1;
        return { data: { value: 1500 }, sources: [{ metric: 'revenue', period: PERIOD, value: 1500, tool: 'get_revenue' }] };
      },
    });
    const { orchestrator } = make([
      { text: 'Receita de R$ 999.999.', toolCalls: [{ name: 'get_revenue' }] },
      { text: 'Receita de R$ 999.999.' },
      { toolCalls: [{ name: 'get_revenue' }] },
      { text: 'A receita confirmada é R$ 1.500.' },
    ], true, new ToolRegistry([read]));
    const answer = await orchestrator.run({ ctx: ctx(), question: 'Receita?' });
    expect(calls).toBe(1);
    expect(answer.content).toContain('1.500');
  });

  it('accepts a labeled projection only when its number is sourced', async () => {
    const projection = defineTool({
      name: 'get_forecast', description: 'Projeção.', inputSchema: z.object({}), recoverySafe: true,
      async execute() {
        return { data: { expected: 2400 }, sources: [{
          metric: 'revenue', period: PERIOD, value: 1500, tool: 'get_forecast',
          numericEvidence: [{ value: 2400, unit: 'number' as const, kind: 'estimated' as const, metric: 'revenue', period: PERIOD }],
        }] };
      },
    });
    const { orchestrator } = make([
      { text: 'A projeção é R$ 999.999.' },
      { toolCalls: [{ name: 'get_forecast' }] },
      { text: 'A estimativa para o período é R$ 2.400.' },
    ], true, new ToolRegistry([projection]));
    const answer = await orchestrator.run({ ctx: ctx(), question: 'Qual a projeção?' });
    expect(answer.resolution).toBe('recovered');
    expect(answer.content).toContain('estimativa');
    expect(answer.content).toContain('2.400');
  });

  it('requires an estimated value to be labeled as such', async () => {
    const forecast = defineTool({
      name: 'get_forecast', description: 'Projeção.', inputSchema: z.object({}),
      async execute() {
        return { data: { expected: 2400 }, sources: [{
          metric: 'revenue', period: PERIOD, tool: 'get_forecast',
          numericEvidence: [{ value: 2400, unit: 'number' as const, kind: 'estimated' as const, metric: 'revenue', period: PERIOD }],
        }] };
      },
    });
    const { orchestrator } = make([
      { toolCalls: [{ name: 'get_forecast' }] },
      { text: 'Vamos fechar em R$ 2.400.' },
      { text: 'A estimativa de fechamento é R$ 2.400.' },
    ], false, new ToolRegistry([forecast]));
    const answer = await orchestrator.run({ ctx: ctx(), question: 'Em quanto fechamos?' });
    expect(answer.guardrail).toBe('claim_mismatch');
    expect(answer.resolution).toBe('recovered');
    expect(answer.content).toContain('estimativa');
  });

  it('does not present the current month as the answer to an explicit earlier period', async () => {
    const { orchestrator } = make([{ text: 'Foram R$ 999.999.' }]);
    const answer = await orchestrator.run({ ctx: ctx(), question: 'Quanto vendemos em agosto?' });
    expect(answer.resolution).toBe('clarification');
    expect(answer.content).not.toContain('1.500');
  });

  it('does not present the current month for a rolling period', async () => {
    const { orchestrator } = make([{ text: 'Foram R$ 999.999.' }]);
    const answer = await orchestrator.run({ ctx: ctx(), question: 'Quanto vendemos nos últimos 30 dias?' });
    expect(answer.resolution).toBe('clarification');
    expect(answer.content).not.toContain('1.500');
  });

  it('does not substitute observed sales for a requested forecast', async () => {
    const { orchestrator } = make([{ text: 'A projeção é R$ 999.999.' }]);
    const answer = await orchestrator.run({ ctx: ctx(), question: 'Qual a projeção de vendas?' });
    expect(answer.resolution).toBe('clarification');
    expect(answer.content).not.toContain('1.500');
  });

  it('uses the prior topic when asking for clarification', async () => {
    const { orchestrator } = make([{ text: 'Ela teve R$ 999.999.' }], false);
    const answer = await orchestrator.run({
      ctx: ctx(),
      question: 'E ela?',
      history: [{ role: 'user', content: 'Como estão os clientes?' }, { role: 'assistant', content: 'Há várias formas de analisar.' }],
    });
    expect(answer.resolution).toBe('clarification');
    expect(answer.content).toContain('cliente');
  });
});
