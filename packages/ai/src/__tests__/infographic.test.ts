import { describe, expect, it } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { createId, type RequestContext } from '@tactia/shared';
import { MockLLMAdapter } from '../adapters/mock-llm-adapter';
import type { AiContext } from '../context-builder';
import { renderInfographic } from '../infographics/render';
import {
  generateInfographicToolInputSchema,
  infographicSpecSchema,
} from '../infographics/schema';
import { Orchestrator, type ContextSource } from '../orchestrator';
import { ToolRegistry } from '../tool-registry';
import { createDefaultTools } from '../tools/index';
import {
  createGenerateInfographicTool,
  type InfographicStore,
} from '../tools/generate-infographic';
import type { ChatAttachment, ChatStreamEvent, ToolContext, ToolDeps } from '../index';

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

function recordingStore() {
  const saved: Array<{ title: string; template: string; bytes: Buffer }> = [];
  const store: InfographicStore = {
    async save(_ctx, input) {
      saved.push({ title: input.title, template: input.template, bytes: input.bytes });
      const attachment: ChatAttachment = {
        id: 'infographic-1',
        type: 'infographic',
        title: input.title,
        mime: input.mime,
        template: input.template,
        url: '/api/v1/infographics/infographic-1',
      };
      return attachment;
    },
  };
  return { store, saved };
}

function contextSource(): ContextSource {
  return {
    async build(): Promise<AiContext> {
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
    },
  };
}

const emptyDeps = {} as ToolDeps;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('generate_infographic tool schema', () => {
  it('exports a top-level JSON Schema object (OpenAI requirement)', () => {
    const json = zodToJsonSchema(generateInfographicToolInputSchema, {
      $refStrategy: 'none',
      target: 'jsonSchema7',
    }) as { type?: string };
    expect(json.type).toBe('object');
  });
});

describe('infographic renderer', () => {
  it('renders kpi_snapshot as a non-empty PNG', async () => {
    const result = await renderInfographic({
      template: 'kpi_snapshot',
      title: 'Resumo do mês',
      subtitle: 'Janeiro 2025',
      payload: {
        items: [
          { label: 'Receita', value: 'R$ 120 mil', delta: 0.12 },
          { label: 'Vendas', value: '842', delta: -0.04 },
        ],
      },
    });
    expect(result.mime).toBe('image/png');
    expect(result.png.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
    expect(result.png.byteLength).toBeGreaterThan(5_000);
  });

  it.each([
    [
      'pie_chart',
      {
        template: 'pie_chart' as const,
        title: 'Mix',
        payload: {
          items: [
            { label: 'A', value: '40%', share: 0.4 },
            { label: 'B', value: '60%', share: 0.6 },
          ],
        },
      },
    ],
    [
      'line_chart',
      {
        template: 'line_chart' as const,
        title: 'Tendência',
        payload: {
          points: [
            { label: 'S1', value: '10', numeric: 10 },
            { label: 'S2', value: '14', numeric: 14 },
            { label: 'S3', value: '12', numeric: 12 },
          ],
        },
      },
    ],
    [
      'period_comparison',
      {
        template: 'period_comparison' as const,
        title: 'Períodos',
        payload: {
          leftLabel: 'Jan',
          rightLabel: 'Dez',
          metrics: [
            { label: 'Receita', left: '100', right: '90', delta: 0.11 },
            { label: 'Pedidos', left: '50', right: '48', delta: 0.04 },
          ],
        },
      },
    ],
    [
      'bar_chart',
      {
        template: 'bar_chart' as const,
        title: 'Barras',
        payload: {
          items: [
            { label: 'A', value: '40', numeric: 40 },
            { label: 'B', value: '25', numeric: 25 },
          ],
        },
      },
    ],
  ])('renders %s as a non-empty PNG', async (_name, spec) => {
    const result = await renderInfographic(spec);
    expect(result.png.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
    expect(result.png.byteLength).toBeGreaterThan(5_000);
  });

  it('rejects invalid payload for template', () => {
    expect(() =>
      infographicSpecSchema.parse({
        template: 'kpi_snapshot',
        title: 'X',
        payload: { items: [] },
      }),
    ).toThrow();
  });
});

describe('generate_infographic tool', () => {
  it('is only registered when an infographic store is injected', () => {
    const readOnly = new ToolRegistry(createDefaultTools(emptyDeps));
    expect(readOnly.has('generate_infographic')).toBe(false);

    const { store } = recordingStore();
    const withInfographics = new ToolRegistry(
      createDefaultTools(emptyDeps, { infographicStore: store }),
    );
    expect(withInfographics.has('generate_infographic')).toBe(true);
  });

  it('persists the PNG and returns an attachment', async () => {
    const { store, saved } = recordingStore();
    const registry = new ToolRegistry([createGenerateInfographicTool(store)]);

    const result = await registry.execute('generate_infographic', toolContext(), {
      template: 'comparison',
      title: 'Receita vs. mês anterior',
      payload: {
        metricLabel: 'Receita',
        left: { label: 'Este mês', value: 'R$ 100 mil', numeric: 100000 },
        right: { label: 'Mês passado', value: 'R$ 80 mil', numeric: 80000 },
        delta: 0.25,
      },
    });

    expect(saved).toHaveLength(1);
    expect(saved[0]?.template).toBe('comparison');
    expect(saved[0]?.bytes.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
    expect(result.attachment).toMatchObject({
      id: 'infographic-1',
      type: 'infographic',
      title: 'Receita vs. mês anterior',
      url: '/api/v1/infographics/infographic-1',
    });
  });

  it('surfaces attachments in the orchestrator answer', async () => {
    const { store } = recordingStore();
    const llm = new MockLLMAdapter({
      script: [
        {
          toolCalls: [
            {
              name: 'generate_infographic',
              input: {
                template: 'insight_card',
                title: 'Queda de receita',
                payload: {
                  highlight: '-12%',
                  highlightLabel: 'Vs. mês anterior',
                  bullets: ['Produto A caiu R$ 8 mil', 'Ticket médio estável'],
                },
              },
            },
          ],
        },
        { text: 'Monteei o infográfico com a queda de receita.\n\n### Próximos passos\n- Ver por produto' },
      ],
    });

    const orchestrator = new Orchestrator({
      llm,
      tools: new ToolRegistry([createGenerateInfographicTool(store)]),
      contextBuilder: contextSource(),
    });

    const answer = await orchestrator.run({
      ctx: toolContext(),
      question: 'Gere um infográfico da queda',
    });

    expect(answer.attachments).toHaveLength(1);
    expect(answer.attachments[0]?.type).toBe('infographic');
    expect(answer.content).toContain('infográfico');
  });

  it('emits attachment on stream tool_result', async () => {
    const { store } = recordingStore();
    const llm = new MockLLMAdapter({
      script: [
        {
          toolCalls: [
            {
              name: 'generate_infographic',
              input: {
                template: 'ranking',
                title: 'Top vendedores',
                payload: {
                  metricLabel: 'Receita',
                  items: [
                    { label: 'Ana', value: 'R$ 40 mil', numeric: 40000 },
                    { label: 'Bruno', value: 'R$ 28 mil', numeric: 28000 },
                  ],
                },
              },
            },
          ],
        },
        { text: 'Pronto.' },
      ],
    });

    const orchestrator = new Orchestrator({
      llm,
      tools: new ToolRegistry([createGenerateInfographicTool(store)]),
      contextBuilder: contextSource(),
    });

    const events: ChatStreamEvent[] = [];
    for await (const event of orchestrator.stream({
      ctx: toolContext(),
      question: 'Mostre o ranking em imagem',
    })) {
      events.push(event);
    }

    const toolResult = events.find((event) => event.type === 'tool_result');
    expect(toolResult?.type === 'tool_result' && toolResult.attachment?.id).toBe('infographic-1');
    const done = events.find((event) => event.type === 'done');
    expect(done?.type === 'done' && done.answer.attachments).toHaveLength(1);
  });
});
