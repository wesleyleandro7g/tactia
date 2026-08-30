/**
 * Orchestrator tests with a mocked LLM (no network, no database).
 *
 * Covers the spec §41 loop and the §43 safety rules:
 * - the answer is produced from tool results, not from model imagination
 * - every numeric answer carries `sources` (metric + period)
 * - tool failures are reported to the model instead of breaking the chat
 * - LLM failures are classified as AI_ERROR
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { MockLLMAdapter } from '../adapters/mock-llm-adapter';
import type { AiContext } from '../context-builder';
import { Orchestrator, type ContextSource } from '../orchestrator';
import { ToolRegistry, defineTool } from '../tool-registry';
import type { ChatStreamEvent, ToolContext } from '../types';

const PERIOD = { from: '2025-01-01T00:00:00.000Z', to: '2025-02-01T00:00:00.000Z' };

function toolContext(): ToolContext {
  const base: RequestContext = {
    requestId: createId(),
    tenantId: 'tenant-1',
    userId: 'user-1',
    role: 'owner',
    ip: '127.0.0.1',
  };
  return base as ToolContext;
}

function contextSource(overrides: Partial<AiContext> = {}): ContextSource {
  return {
    async build() {
      return {
        company: {
          id: 'tenant-1',
          name: 'Demo Ltda',
          currency: 'BRL',
          timezone: 'America/Sao_Paulo',
          today: '2025-01-31',
        },
        period: PERIOD,
        metrics: [{ key: 'revenue', value: 1000, change: -0.5, direction: 'down' }],
        insights: [
          {
            id: 'insight-1',
            ruleKey: 'revenue_drop',
            type: 'anomaly',
            severity: 'high',
            title: 'Queda de receita de 50%',
          },
        ],
        sources: [{ metric: 'revenue', period: PERIOD, value: 1000, tool: 'context' }],
        ...overrides,
      };
    },
  };
}

const revenueTool = defineTool({
  name: 'get_revenue',
  description: 'Receita do período.',
  inputSchema: z.object({ from: z.string().optional(), to: z.string().optional() }),
  async execute() {
    return {
      data: { metric: 'revenue', value: 1500, period: PERIOD },
      sources: [{ metric: 'revenue', period: PERIOD, value: 1500, tool: 'get_revenue' }],
    };
  },
});

const brokenTool = defineTool({
  name: 'get_sellers',
  description: 'Ranking de vendedores.',
  inputSchema: z.object({}),
  async execute() {
    throw new Error('database unavailable');
  },
});

function registry() {
  return new ToolRegistry([revenueTool, brokenTool]);
}

describe('Orchestrator', () => {
  it('answers from tool results and carries the evidence', async () => {
    const llm = new MockLLMAdapter({
      script: [
        { toolCalls: [{ name: 'get_revenue', input: { from: PERIOD.from, to: PERIOD.to } }] },
        { text: 'A receita foi de R$ 1.500 no período de janeiro.' },
      ],
    });
    const orchestrator = new Orchestrator({
      llm,
      tools: registry(),
      contextBuilder: contextSource(),
    });

    const answer = await orchestrator.run({
      ctx: toolContext(),
      question: 'Quanto vendemos este mês?',
    });

    expect(answer.content).toContain('1.500');
    expect(answer.toolCalls).toHaveLength(1);
    expect(answer.toolCalls[0]?.name).toBe('get_revenue');
    expect(answer.provider).toBe('mock');

    // Evidence: context metric + tool result, deduplicated by metric+period
    const toolSource = answer.sources.find((source) => source.tool === 'get_revenue');
    expect(toolSource?.metric).toBe('revenue');
    expect(toolSource?.period).toEqual(PERIOD);
    expect(answer.sources.length).toBeGreaterThan(0);
  });

  it('feeds the tool output back to the model', async () => {
    const llm = new MockLLMAdapter({
      script: [{ toolCalls: [{ name: 'get_revenue' }] }, { text: 'Receita de 1500.' }],
    });
    const orchestrator = new Orchestrator({
      llm,
      tools: registry(),
      contextBuilder: contextSource(),
    });

    await orchestrator.run({ ctx: toolContext(), question: 'Qual a receita?' });

    expect(llm.requests).toHaveLength(2);
    const second = llm.requests[1]!;
    const toolMessage = second.messages.find((message) => message.role === 'tool');
    expect(toolMessage).toBeDefined();
    expect(JSON.stringify(toolMessage)).toContain('1500');

    // The system prompt carries the structured context (spec §41)
    expect(second.system).toContain('Demo Ltda');
    expect(second.system).toContain('revenue');
    expect(second.system).toContain('Queda de receita');
    // Tools are always offered to the model
    expect(second.tools?.map((tool) => tool.name)).toContain('get_revenue');
  });

  it('never sends unsourced numbers to the user', async () => {
    const llm = new MockLLMAdapter({
      script: [{ text: 'A receita foi de R$ 999.999,00.' }],
    });
    const orchestrator = new Orchestrator({
      llm,
      tools: registry(),
      // No metrics and no sources available
      contextBuilder: contextSource({ metrics: [], insights: [], sources: [] }),
    });

    const answer = await orchestrator.run({ ctx: toolContext(), question: 'Quanto vendemos?' });

    expect(answer.guardrail).toBe('unsourced_numbers');
    expect(answer.content).not.toContain('999.999');
    expect(answer.sources).toHaveLength(0);
  });

  it('keeps text answers without numbers untouched', async () => {
    const llm = new MockLLMAdapter({ script: [{ text: 'Sem dados suficientes para responder.' }] });
    const orchestrator = new Orchestrator({
      llm,
      tools: registry(),
      contextBuilder: contextSource({ metrics: [], insights: [], sources: [] }),
    });

    const answer = await orchestrator.run({ ctx: toolContext(), question: 'E aí?' });
    expect(answer.guardrail).toBeUndefined();
    expect(answer.content).toBe('Sem dados suficientes para responder.');
  });

  it('reports tool failures to the model instead of breaking the chat', async () => {
    const llm = new MockLLMAdapter({
      script: [
        { toolCalls: [{ name: 'get_sellers' }] },
        { text: 'Não consegui consultar os vendedores agora.' },
      ],
    });
    const orchestrator = new Orchestrator({
      llm,
      tools: registry(),
      contextBuilder: contextSource(),
    });

    const answer = await orchestrator.run({ ctx: toolContext(), question: 'Quem mais vendeu?' });

    expect(answer.toolCalls[0]?.error).toContain('database unavailable');
    expect(answer.content).toContain('Não consegui');
    expect(JSON.stringify(llm.requests[1]!.messages)).toContain('database unavailable');
  });

  it('classifies invalid tool input as a tool error (input never reaches execute)', async () => {
    const strictTool = defineTool({
      name: 'get_products',
      description: 'Ranking de produtos.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(10) }),
      async execute() {
        return { data: { ok: true }, sources: [] };
      },
    });
    const llm = new MockLLMAdapter({
      script: [
        { toolCalls: [{ name: 'get_products', input: { limit: 5000 } }] },
        { text: 'Pedido inválido.' },
      ],
    });
    const orchestrator = new Orchestrator({
      llm,
      tools: new ToolRegistry([strictTool]),
      contextBuilder: contextSource(),
    });

    const answer = await orchestrator.run({ ctx: toolContext(), question: 'Top 5000 produtos?' });
    expect(answer.toolCalls[0]?.error).toContain('get_products');
  });

  it('classifies LLM failures as AI_ERROR', async () => {
    const llm = new MockLLMAdapter({ script: [], failWith: 'provider timeout' });
    const orchestrator = new Orchestrator({
      llm,
      tools: registry(),
      contextBuilder: contextSource(),
    });

    await expect(
      orchestrator.run({ ctx: toolContext(), question: 'Quanto vendemos?' }),
    ).rejects.toMatchObject({ code: ErrorCode.AI_ERROR });
  });

  it('stops the tool loop at maxIterations and still answers', async () => {
    const llm = new MockLLMAdapter({
      script: [
        { toolCalls: [{ name: 'get_revenue' }] },
        { toolCalls: [{ name: 'get_revenue' }] },
        { text: 'Resumo final com receita de 1500.' },
      ],
    });
    const orchestrator = new Orchestrator(
      { llm, tools: registry(), contextBuilder: contextSource() },
      { maxIterations: 2 },
    );

    const answer = await orchestrator.run({ ctx: toolContext(), question: 'Receita?' });

    expect(answer.guardrail).toBe('max_iterations');
    expect(answer.toolCalls).toHaveLength(2);
    expect(answer.content).toContain('1500');
    // Final forced call happens without tools
    expect(llm.requests[2]?.tools).toBeUndefined();
  });

  it('sends previous turns as history, limited by historyLimit', async () => {
    const llm = new MockLLMAdapter({ script: [{ text: 'Ok.' }] });
    const orchestrator = new Orchestrator(
      { llm, tools: registry(), contextBuilder: contextSource() },
      { historyLimit: 2 },
    );

    await orchestrator.run({
      ctx: toolContext(),
      question: 'E agora?',
      history: [
        { role: 'user', content: 'primeira' },
        { role: 'assistant', content: 'segunda' },
        { role: 'user', content: 'terceira' },
        { role: 'assistant', content: 'quarta' },
      ],
    });

    const messages = llm.requests[0]!.messages;
    expect(messages).toHaveLength(3); // 2 history + current question
    expect(messages[0]).toEqual({ role: 'user', content: 'terceira' });
    expect(messages[2]).toEqual({ role: 'user', content: 'E agora?' });
  });

  it('streams tool activity, text deltas and a final done event', async () => {
    const llm = new MockLLMAdapter({
      script: [{ toolCalls: [{ name: 'get_revenue' }] }, { text: 'Receita de 1500 reais.' }],
    });
    const orchestrator = new Orchestrator({
      llm,
      tools: registry(),
      contextBuilder: contextSource(),
    });

    const events: ChatStreamEvent[] = [];
    for await (const event of orchestrator.stream({
      ctx: toolContext(),
      question: 'Quanto vendemos?',
    })) {
      events.push(event);
    }

    const types = events.map((event) => event.type);
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('text');
    expect(types.at(-1)).toBe('done');

    const done = events.at(-1);
    if (done?.type !== 'done') throw new Error('expected done event');
    expect(done.answer.content).toContain('1500');
    expect(done.answer.sources.some((source) => source.tool === 'get_revenue')).toBe(true);
  });
});
