/**
 * Shared chat stack end-to-end with a real Postgres and a scripted LLM:
 * an operator (admin test chat, no domain user) runs an ephemeral turn.
 *
 * Env: DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockLLMAdapter } from '@tactia/ai';
import { prisma, TenantRepository } from '@tactia/database';
import { createId, type RequestContext } from '@tactia/shared';
import { ephemeralTurnSchema, type ChatStreamEvent } from '../protocol';
import {
  answerMetadata,
  createChatRuntime,
  createChatServices,
  isLlmConfigured,
  runChatTurnSync,
  streamChatTurn,
  toToolContext,
} from '../server';

const SLUG = 'chat-pkg-co';
let tenantId: string;

const services = createChatServices({
  prisma,
  env: { LLM_PROVIDER: 'mock' },
  browserQueue: () => null,
});

function operatorCtx(): RequestContext {
  return {
    requestId: createId(),
    tenantId,
    userId: null,
    role: 'owner',
    operatorId: createId(),
  };
}

async function readEvents(response: Response): Promise<ChatStreamEvent[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .map((frame) => frame.split('\n').find((line) => line.startsWith('data: ')))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)) as ChatStreamEvent);
}

async function cleanUp() {
  const rows = await prisma.tenant.findMany({ where: { slug: SLUG } });
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await prisma.$connect();
  await cleanUp();
  tenantId = (await new TenantRepository(prisma).create({ name: 'Chat Co', slug: SLUG })).id;
});

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

describe('toToolContext', () => {
  it('accepts a client user and a backoffice operator', () => {
    const user = toToolContext({ requestId: 'r', tenantId: 't', userId: 'u', role: 'member' });
    expect(user.userId).toBe('u');
    const operator = toToolContext({
      requestId: 'r',
      tenantId: 't',
      userId: null,
      role: 'owner',
      operatorId: 'op',
    });
    expect(operator.userId).toBeNull();
    expect(operator.operatorId).toBe('op');
  });

  it('rejects contexts without tenant, role or principal', () => {
    expect(() => toToolContext({ requestId: 'r', tenantId: null, userId: 'u', role: 'owner' })).toThrow();
    expect(() => toToolContext({ requestId: 'r', tenantId: 't', userId: 'u', role: null })).toThrow();
    expect(() => toToolContext({ requestId: 'r', tenantId: 't', userId: null, role: 'owner' })).toThrow();
  });
});

describe('answerMetadata', () => {
  it('redacts sensitive tool inputs', () => {
    const metadata = answerMetadata({
      content: 'ok',
      followUps: [],
      sources: [],
      toolCalls: [{ name: 'x', input: { note: 'CPF 123.456.789-09' }, durationMs: 1 }],
      proposals: [],
      attachments: [],
      provider: 'mock',
      model: 'mock-model',
    } as never);
    expect(JSON.stringify(metadata)).not.toContain('123.456.789-09');
    expect(JSON.stringify(metadata)).toContain('[cpf]');
  });
});

describe('ephemeralTurnSchema', () => {
  it('accepts user/assistant history and defaults to empty', () => {
    expect(ephemeralTurnSchema.parse({ content: ' oi ' })).toEqual({ content: 'oi', history: [] });
  });

  it('rejects system/tool roles and oversized history', () => {
    expect(() =>
      ephemeralTurnSchema.parse({ content: 'oi', history: [{ role: 'system', content: 'x' }] }),
    ).toThrow();
    expect(() =>
      ephemeralTurnSchema.parse({
        content: 'oi',
        history: Array.from({ length: 13 }, () => ({ role: 'user', content: 'x' })),
      }),
    ).toThrow();
    expect(() => ephemeralTurnSchema.parse({ content: 'x'.repeat(4001) })).toThrow();
  });
});

describe('isLlmConfigured', () => {
  it('requires an API key or the mock provider', () => {
    expect(isLlmConfigured({})).toBe(false);
    expect(isLlmConfigured({ LLM_PROVIDER: 'mock' })).toBe(true);
    expect(isLlmConfigured({ LLM_API_KEY: 'k' })).toBe(true);
  });
});

describe('ephemeral chat turn as an operator', () => {
  it('streams start → tool → text → done without persisting a conversation', async () => {
    const llm = new MockLLMAdapter({
      script: [
        { toolCalls: [{ name: 'get_revenue', input: {} }] },
        { text: 'Consultei a receita do período.' },
      ],
    });
    const runtime = createChatRuntime(services, { llm: () => llm });
    const ctx = operatorCtx();

    const response = streamChatTurn({
      runtime,
      ctx,
      toolCtx: toToolContext(ctx),
      question: 'Quanto vendemos este mês?',
      history: [{ role: 'user', content: 'Olá' }, { role: 'assistant', content: 'Oi!' }],
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const events = await readEvents(response);
    const types = events.map((event) => event.type);
    expect(types[0]).toBe('start');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types.at(-1)).toBe('done');

    const start = events[0] as Extract<ChatStreamEvent, { type: 'start' }>;
    expect(start.conversationId).toBeNull();
    const toolResult = events.find((event) => event.type === 'tool_result') as Extract<
      ChatStreamEvent,
      { type: 'tool_result' }
    >;
    expect(toolResult.error).toBeUndefined();
    const done = events.at(-1) as Extract<ChatStreamEvent, { type: 'done' }>;
    expect(done.messageId).toMatch(/^ephemeral-/);
    expect(done.content).toContain('receita');

    // The client-provided history reached the model.
    const lastRequest = llm.requests.at(-1)!;
    expect(JSON.stringify(lastRequest.messages)).toContain('Oi!');

    expect(await prisma.conversation.count({ where: { tenantId } })).toBe(0);
    expect(await prisma.message.count({ where: { tenantId } })).toBe(0);
  });

  it('emits an error event when the model fails', async () => {
    const runtime = createChatRuntime(services, {
      llm: () => new MockLLMAdapter({ script: [], failWith: 'provider down' }),
    });
    const ctx = operatorCtx();
    const events = await readEvents(
      streamChatTurn({ runtime, ctx, toolCtx: toToolContext(ctx), question: 'Oi', history: [] }),
    );
    expect(events.map((event) => event.type)).toEqual(['start', 'error']);
    expect(events[1]).toMatchObject({ type: 'error', code: 'AI_ERROR' });
  });

  it('runs synchronously and calls the persistence hook when provided', async () => {
    const runtime = createChatRuntime(services, {
      llm: () => new MockLLMAdapter({ script: [{ text: 'Tudo certo.' }] }),
    });
    const ctx = operatorCtx();
    const saved: string[] = [];
    const result = await runChatTurnSync({
      runtime,
      ctx,
      toolCtx: toToolContext(ctx),
      question: 'Oi',
      history: [],
      persistence: {
        conversationId: createId(),
        userMessageId: createId(),
        saveAnswer: async (answer) => {
          saved.push(answer.content);
          return { id: 'message-1' };
        },
      },
    });
    expect(result.message).toEqual({ id: 'message-1' });
    expect(result.answer.content).toBe('Tudo certo.');
    expect(saved).toEqual(['Tudo certo.']);
  });

  it('injects the global catalog and loads one secondary skill on demand', async () => {
    const ctx = operatorCtx();
    await prisma.agentSkill.createMany({ data: [
      { id: createId(), tenantId, kind: 'global', slug: 'company_global', title: 'Global', description: '', markdown: 'A empresa usa Torge para clientes. Consulte skill:torge_skill.' },
      { id: createId(), tenantId, kind: 'secondary', slug: 'torge_skill', title: 'Torge', description: 'Clientes, notas e relatórios no Torge.', markdown: 'Para usuários, navegue em Cadastros > Usuários.' },
    ] });
    const llm = new MockLLMAdapter({
      script: [
        { toolCalls: [{ name: 'load_company_skill', input: { slug: 'torge_skill' } }] },
        { text: 'Carreguei a orientação operacional da Torge.' },
      ],
    });
    const runtime = createChatRuntime(services, { llm: () => llm });
    const result = await runChatTurnSync({
      runtime, ctx, toolCtx: toToolContext(ctx), question: 'Como consultar usuários no Torge?', history: [],
    });

    expect(result.answer.toolCalls.map((call) => call.name)).toContain('load_company_skill');
    expect(llm.requests[0]?.system).toContain('skill:torge_skill');
    expect(llm.requests[0]?.system).not.toContain('Cadastros > Usuários');
    expect(JSON.stringify(llm.requests[1]?.messages)).toContain('Cadastros > Usuários');
  });
});
