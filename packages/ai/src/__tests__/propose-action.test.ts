/**
 * propose_action tests (Etapa 7 integration with the chat).
 *
 * The assistant may only *propose*: the tool returns a proposal that is parked
 * for human approval, the orchestrator surfaces it in `ChatAnswer.proposals`
 * and the system prompt forbids claiming the action was executed (spec §44).
 */

import { describe, expect, it } from 'vitest';
import { createId, ErrorCode, type RequestContext } from '@tactia/shared';
import { MockLLMAdapter } from '../adapters/mock-llm-adapter';
import type { AiContext } from '../context-builder';
import { Orchestrator, type ContextSource } from '../orchestrator';
import { buildSystemPrompt } from '../system-prompt';
import { ToolRegistry } from '../tool-registry';
import { createDefaultTools } from '../tools/index';
import { createProposeActionTool, type ActionProposalPort } from '../tools/propose-action';
import type { ActionProposal, ChatStreamEvent, ToolContext, ToolDeps } from '../index';

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

/** Records what the engine would receive. */
function recordingProposer(overrides: Partial<ActionProposal> = {}) {
  const calls: Array<{ actionType: string; input: Record<string, unknown>; reason?: string | null }> =
    [];
  const port: ActionProposalPort = {
    async propose(_ctx, input) {
      calls.push(input);
      return {
        id: 'execution-1',
        actionType: input.actionType,
        status: 'awaiting_approval',
        requiresApproval: true,
        approvalId: 'approval-1',
        ...overrides,
      };
    },
  };
  return { port, calls };
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

describe('propose_action tool', () => {
  it('is only registered when an action proposer is injected', () => {
    const readOnly = new ToolRegistry(createDefaultTools(emptyDeps));
    expect(readOnly.has('propose_action')).toBe(false);
    const readOnlyCount = readOnly.names().length;
    expect(readOnlyCount).toBeGreaterThanOrEqual(18);

    const { port } = recordingProposer();
    const withActions = new ToolRegistry(
      createDefaultTools(emptyDeps, { actionProposer: port }),
    );
    expect(withActions.has('propose_action')).toBe(true);
    expect(withActions.names()).toHaveLength(readOnlyCount + 1);
  });

  it('forwards the structured payload to the execution engine', async () => {
    const { port, calls } = recordingProposer();
    const registry = new ToolRegistry([createProposeActionTool(port)]);

    const result = await registry.execute('propose_action', toolContext(), {
      actionType: 'create_task',
      input: { title: 'Ligar para o cliente ABC' },
      reason: 'Cliente inativo há 40 dias',
    });

    expect(calls[0]).toEqual({
      actionType: 'create_task',
      input: { title: 'Ligar para o cliente ABC' },
      reason: 'Cliente inativo há 40 dias',
    });

    expect(result.proposal).toMatchObject({
      id: 'execution-1',
      actionType: 'create_task',
      status: 'awaiting_approval',
      requiresApproval: true,
    });
    const data = result.data as { status: string; message: string };
    expect(data.status).toBe('awaiting_approval');
    expect(data.message).toContain('aprovação');
    // A proposal is not evidence about numbers
    expect(result.sources).toHaveLength(0);
  });

  it('rejects action types outside the V0.1 set', async () => {
    const { port } = recordingProposer();
    const registry = new ToolRegistry([createProposeActionTool(port)]);

    await expect(
      registry.execute('propose_action', toolContext(), {
        actionType: 'send_whatsapp',
        input: {},
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it('surfaces the proposal in the answer so the UI can render an approval button', async () => {
    const { port } = recordingProposer();
    const llm = new MockLLMAdapter({
      script: [
        {
          toolCalls: [
            {
              name: 'propose_action',
              input: { actionType: 'create_task', input: { title: 'Ligar para o cliente' } },
            },
          ],
        },
        { text: 'Registrei a tarefa como proposta; ela está pendente de aprovação.' },
      ],
    });

    const orchestrator = new Orchestrator({
      llm,
      tools: new ToolRegistry([createProposeActionTool(port)]),
      contextBuilder: contextSource(),
    });

    const answer = await orchestrator.run({
      ctx: toolContext(),
      question: 'Crie uma tarefa para ligar para o cliente',
    });

    expect(answer.proposals).toHaveLength(1);
    expect(answer.proposals[0]).toMatchObject({
      id: 'execution-1',
      actionType: 'create_task',
      status: 'awaiting_approval',
    });
    expect(answer.content).toContain('pendente de aprovação');
  });

  it('emits the proposal in the stream tool_result event', async () => {
    const { port } = recordingProposer();
    const llm = new MockLLMAdapter({
      script: [
        {
          toolCalls: [
            {
              name: 'propose_action',
              input: { actionType: 'send_email', input: { to: 'a@b.com' } },
            },
          ],
        },
        { text: 'Proposta registrada.' },
      ],
    });

    const orchestrator = new Orchestrator({
      llm,
      tools: new ToolRegistry([createProposeActionTool(port)]),
      contextBuilder: contextSource(),
    });

    const events: ChatStreamEvent[] = [];
    for await (const event of orchestrator.stream({
      ctx: toolContext(),
      question: 'Envie um e-mail para a@b.com',
    })) {
      events.push(event);
    }

    const toolResult = events.find((event) => event.type === 'tool_result');
    if (toolResult?.type !== 'tool_result') throw new Error('expected tool_result event');
    expect(toolResult.proposal?.actionType).toBe('send_email');

    const done = events.at(-1);
    if (done?.type !== 'done') throw new Error('expected done event');
    expect(done.answer.proposals).toHaveLength(1);
  });

  it('turns an engine rejection into a tool error the model can explain', async () => {
    const failing: ActionProposalPort = {
      async propose() {
        throw new Error('Ação send_email está desativada');
      },
    };
    const llm = new MockLLMAdapter({
      script: [
        {
          toolCalls: [
            { name: 'propose_action', input: { actionType: 'send_email', input: { to: 'a@b.com' } } },
          ],
        },
        { text: 'Não consegui registrar a proposta.' },
      ],
    });

    const orchestrator = new Orchestrator({
      llm,
      tools: new ToolRegistry([createProposeActionTool(failing)]),
      contextBuilder: contextSource(),
    });

    const answer = await orchestrator.run({ ctx: toolContext(), question: 'Envie um e-mail' });

    expect(answer.proposals).toHaveLength(0);
    expect(answer.toolCalls[0]?.error).toContain('desativada');
    expect(answer.content).toContain('Não consegui');
  });

  it('changes the system prompt rule when actions can be proposed', () => {
    const context: AiContext = {
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
      metrics: [],
      insights: [],
      sources: [],
    };

    const readOnly = buildSystemPrompt(context, ['get_revenue']);
    expect(readOnly).toContain('Não prometa executar ações');

    const withActions = buildSystemPrompt(context, ['get_revenue', 'propose_action']);
    expect(withActions).toContain('propose_action');
    expect(withActions).toContain('pendente de aprovação');
    expect(withActions).not.toContain('Não prometa executar ações');
  });
});
