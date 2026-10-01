import { describe, expect, it } from 'vitest';
import type { ChatMessageView, ChatStreamEvent } from '../protocol';
import {
  STREAMING_MESSAGE_ID,
  WORK_PHASE_LABELS,
  WORK_RETRY_LABEL,
  appendBrowserResponse,
  applyStreamEvent,
  buildWorkTrail,
  hasNonSystemWork,
  historyFromMessages,
  parseSseFrames,
  sourceLines,
  sourceSummary,
  streamEventEffects,
  toolShortLabel,
  workPhaseForTool,
} from '../ui/chat-client';
import {
  operatorTenantChatEndpoints,
  persistentChatEndpoints,
  rewriteChatAssetUrl,
} from '../ui/endpoints';

const frame = (event: ChatStreamEvent) => `data: ${JSON.stringify(event)}\n\n`;

function streamingThread(): ChatMessageView[] {
  return [
    { id: 'u1', role: 'user', content: 'Quanto vendemos?' },
    { id: STREAMING_MESSAGE_ID, role: 'assistant', content: '', toolsUsed: [] },
  ];
}

describe('parseSseFrames', () => {
  it('returns complete events and keeps the partial frame', () => {
    const text = frame({ type: 'text', delta: 'Olá' });
    const buffer = text + text.slice(0, 10);
    const { events, rest } = parseSseFrames(buffer);
    expect(events).toEqual([{ type: 'text', delta: 'Olá' }]);
    expect(rest).toBe(text.slice(0, 10));
    expect(parseSseFrames(rest + text.slice(10)).events).toEqual([{ type: 'text', delta: 'Olá' }]);
  });

  it('skips malformed frames and non-data lines', () => {
    const { events } = parseSseFrames(`: ping\n\ndata: {oops\n\n${frame({ type: 'text', delta: 'x' })}`);
    expect(events).toEqual([{ type: 'text', delta: 'x' }]);
  });
});

describe('applyStreamEvent', () => {
  it('accumulates tools, sources, attachments and browser tasks on the streaming message', () => {
    let messages = streamingThread();
    messages = applyStreamEvent(messages, {
      type: 'tool_result',
      name: 'get_revenue',
      sources: [{ metric: 'revenue' }],
      attachment: { id: 'a1', type: 'infographic', title: 'T', mime: 'image/png', template: 'kpi', url: '/api/v1/infographics/a1' },
    }).messages;
    messages = applyStreamEvent(messages, {
      type: 'tool_result',
      name: 'browser_delegate',
      browserTaskId: 'task-1',
    }).messages;
    messages = applyStreamEvent(messages, { type: 'text', delta: 'Vendemos ' }).messages;
    messages = applyStreamEvent(messages, { type: 'text', delta: 'R$ 10' }).messages;

    const streaming = messages.find((message) => message.id === STREAMING_MESSAGE_ID)!;
    expect(streaming.toolsUsed).toEqual(['get_revenue', 'browser_delegate']);
    expect(streaming.sources).toEqual([{ metric: 'revenue' }]);
    expect(streaming.attachments?.map((item) => item.id)).toEqual(['a1']);
    expect(streaming.browserTaskIds).toEqual(['task-1']);
    expect(streaming.content).toBe('Vendemos R$ 10');
    expect(messages[0]).toEqual(streamingThread()[0]);
  });

  it('replaces the placeholder with the final answer on done', () => {
    const { messages } = applyStreamEvent(streamingThread(), {
      type: 'done',
      messageId: 'm1',
      content: 'Final',
      followUps: ['E no mês passado?'],
      toolCalls: [{ name: 'get_revenue' }],
    });
    expect(messages[1]).toMatchObject({
      id: 'm1',
      content: 'Final',
      followUps: ['E no mês passado?'],
      toolsUsed: ['get_revenue'],
    });
  });

  it('turns an error event into an error message and a banner', () => {
    const reduction = applyStreamEvent(
      streamingThread(),
      { type: 'error', code: 'AI_ERROR', message: 'Falha' },
      () => 42,
    );
    expect(reduction.messages[1]).toEqual({ id: 'error-42', role: 'assistant', content: 'Falha', error: 'AI_ERROR' });
    expect(reduction.error).toEqual({ code: 'AI_ERROR', message: 'Falha' });
  });
});

describe('streamEventEffects', () => {
  it('drives the work phase without leaking tool slugs', () => {
    expect(streamEventEffects({ type: 'tool_call', name: 'get_revenue', input: {} }).work).toEqual({
      phase: 'numbers',
      retrying: false,
    });
    expect(streamEventEffects({ type: 'tool_call', name: 'new_tool', input: {} }).work).toEqual({
      phase: 'other',
      retrying: false,
    });
    expect(workPhaseForTool('new_tool')).toBe('other');
    expect(WORK_PHASE_LABELS.other).toBe('Consultando os dados da empresa');
    expect(toolShortLabel('new_tool')).toBe('dados da empresa');
    expect(streamEventEffects({ type: 'tool_result', name: 'get_sales', error: 'x' }).work).toEqual({
      phase: 'numbers',
      retrying: true,
    });
    expect(streamEventEffects({ type: 'tool_result', name: 'get_sales' })).toEqual({});
    expect(streamEventEffects({ type: 'text', delta: 'a' })).toEqual({ work: null });
  });
});

describe('buildWorkTrail', () => {
  it('collapses consecutive tools of the same phase and keeps the live one', () => {
    const trail = buildWorkTrail(
      ['get_revenue', 'get_sales', 'get_rfm', 'browser_delegate'],
      { phase: 'system', retrying: false },
    );
    expect(trail.hidden).toEqual([]);
    expect(trail.visible.map((step) => step.label)).toEqual([
      'Conferiu os números',
      'Analisou o que mudou',
      'Acessando o sistema',
    ]);
    expect(trail.visible.map((step) => step.status)).toEqual(['done', 'done', 'active']);
  });

  it('hides older phases behind a short visible tail', () => {
    const trail = buildWorkTrail(
      ['get_revenue', 'search_documents', 'get_trend', 'propose_action'],
      { phase: 'prepare', retrying: false },
    );
    expect(trail.hidden.map((step) => step.phase)).toEqual(['numbers']);
    expect(trail.visible.map((step) => step.phase)).toEqual(['search', 'analysis', 'prepare']);
  });

  it('turns the current phase into a retry sentence without naming the tool', () => {
    const trail = buildWorkTrail(['get_cohorts'], { phase: 'analysis', retrying: true });
    expect(trail.visible).toEqual([
      { phase: 'analysis', label: WORK_RETRY_LABEL, status: 'retry' },
    ]);
    expect(WORK_RETRY_LABEL).not.toContain('get_cohorts');
  });

  it('drops the system phase once the access card is on screen', () => {
    const trail = buildWorkTrail(
      ['get_revenue', 'browser_delegate'],
      { phase: 'system', retrying: false },
      { omitSystem: true },
    );
    expect(trail.visible.map((step) => step.phase)).toEqual(['numbers']);
    expect(hasNonSystemWork(['browser_delegate'])).toBe(false);
    expect(hasNonSystemWork(['get_revenue', 'browser_agent'])).toBe(true);
  });
});

describe('sourceSummary', () => {
  const period = { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' };

  it('groups repeated metrics and omits tool names', () => {
    const sources = [
      { metric: 'revenue', period, tool: 'get_revenue' },
      { metric: 'revenue', period, tool: 'get_revenue' },
      { metric: 'sales_count', period, tool: 'get_sales' },
    ];
    expect(sourceSummary(sources)).toBe('Baseado em Receita e Vendas · 01/08/2026 a 01/09/2026');
    expect(sourceLines(sources).map((line) => line.label)).toEqual([
      'Receita — 01/08/2026 a 01/09/2026',
      'Vendas — 01/08/2026 a 01/09/2026',
    ]);
    expect(sourceLines(sources).some((line) => line.label.includes('get_'))).toBe(false);
  });

  it('keeps each external citation as a dated link', () => {
    const sources = [
      { metric: 'external_web', label: 'Relatório A', url: 'https://example.org/a', publishedAt: '2026-09-01' },
      { metric: 'external_web', label: 'Relatório B', url: 'https://example.org/b' },
    ];
    expect(sourceLines(sources)).toEqual([
      { key: 'https://example.org/a', label: 'Relatório A · 2026-09-01', url: 'https://example.org/a' },
      { key: 'https://example.org/b', label: 'Relatório B', url: 'https://example.org/b' },
    ]);
    expect(sourceSummary(sources)).toBe('Baseado em fontes públicas');
  });

  it('drops the period from the summary when the sources disagree', () => {
    const summary = sourceSummary([
      { metric: 'revenue', period },
      { metric: 'revenue', period: { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' } },
    ]);
    expect(summary).toBe('Baseado em Receita');
    expect(sourceLines([
      { metric: 'revenue', period },
      { metric: 'revenue', period: { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' } },
    ])).toHaveLength(2);
  });
});

describe('historyFromMessages', () => {
  it('keeps completed user/assistant turns, newest last, capped', () => {
    const messages: ChatMessageView[] = [
      { id: '1', role: 'user', content: 'a' },
      { id: '2', role: 'assistant', content: 'b' },
      { id: '3', role: 'assistant', content: 'falhou', error: 'AI_ERROR' },
      { id: '4', role: 'tool', content: 'raw' },
      { id: '5', role: 'user', content: 'c' },
      { id: STREAMING_MESSAGE_ID, role: 'assistant', content: 'parcial' },
    ];
    expect(historyFromMessages(messages)).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]);
    expect(historyFromMessages(messages, 2)).toEqual([
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]);
  });
});

describe('chat endpoints', () => {
  it('rewrites domain asset URLs to the admin test chat routes', () => {
    const base = '/api/v1/tenants/t-1/chat';
    expect(rewriteChatAssetUrl('/api/v1/infographics/abc', base)).toBe(`${base}/infographics/abc`);
    expect(rewriteChatAssetUrl('/api/v1/browser/artifacts/x?y=1', base)).toBe(`${base}/browser/artifacts/x`);
    expect(rewriteChatAssetUrl('https://example.com/a.png', base)).toBe('https://example.com/a.png');
  });

  it('maps admin and web routes', () => {
    const admin = operatorTenantChatEndpoints('t 1');
    expect(admin.createConversation).toBeUndefined();
    expect(admin.browserTaskUrl('k')).toBe('/api/v1/tenants/t%201/chat/browser/tasks/k');
    expect(admin.cancelBrowserTaskUrl('k')).toBe('/api/v1/tenants/t%201/chat/browser/tasks/k/cancel');
    expect(admin.approvalDecisionUrl('a', 'approve')).toBe('/api/v1/tenants/t%201/chat/approvals/a/approve');
    expect(admin.assetUrl('/api/v1/infographics/i')).toBe('/api/v1/tenants/t%201/chat/infographics/i');

    const web = persistentChatEndpoints();
    expect(web.browserTaskUrl('k')).toBe('/api/v1/browser/tasks/k');
    expect(web.approvalDecisionUrl('a', 'reject')).toBe('/api/v1/approvals/a/reject');
    expect(web.assetUrl('/api/v1/infographics/i')).toBe('/api/v1/infographics/i');
  });
});


describe('appendBrowserResponse', () => {
  it('appends once and deduplicates persisted/local ids by browser task', () => {
    const response: ChatMessageView = {
      id: 'browser-result-task-1', role: 'assistant', content: 'Resultado', browserResultTaskId: 'task-1',
    };
    const once = appendBrowserResponse([], response);
    expect(once).toEqual([response]);
    expect(appendBrowserResponse(once, { ...response, id: 'persisted-message-1' })).toBe(once);
  });
});
