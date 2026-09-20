/**
 * Etapa 17 — MCP adapter over ToolRegistry (no second orchestrator).
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { ToolRegistry, defineTool } from '../tool-registry';
import { createDefaultTools, type ActionProposalPort, type ToolDeps } from '../tools/index';
import { handleMcpHttpRequest, PROPOSE_ACTION_TOOL } from '../mcp/server';
import type { ToolContext } from '../types';

const OWNER = '11111111-1111-4111-8111-111111111111';
const VICTIM = '22222222-2222-4222-8222-222222222222';

function toolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const base: RequestContext = {
    requestId: createId(),
    tenantId: OWNER,
    userId: 'user-1',
    role: 'owner',
    ip: '127.0.0.1',
  };
  return { ...base, origin: 'mcp', ...overrides } as ToolContext;
}

function revenueTool() {
  return defineTool({
    name: 'get_revenue',
    description: 'Receita do período.',
    inputSchema: z.object({ tenantId: z.string().optional() }).passthrough(),
    async execute(ctx, input) {
      return {
        data: {
          tenantId: ctx.tenantId,
          requested: input.tenantId ?? null,
          value: ctx.tenantId === OWNER ? 1500 : 0,
        },
        sources: [{ metric: 'revenue', value: ctx.tenantId === OWNER ? 1500 : 0, tool: 'get_revenue' }],
      };
    },
  });
}

function recordingProposer() {
  const calls: Array<{ origin?: string; actionType: string }> = [];
  const port: ActionProposalPort = {
    async propose(ctx, input) {
      calls.push({ origin: ctx.origin, actionType: input.actionType });
      return {
        id: 'execution-mcp-1',
        actionType: input.actionType,
        status: 'awaiting_approval',
        requiresApproval: true,
        approvalId: 'approval-mcp-1',
      };
    },
  };
  return { port, calls };
}

async function mcpRpc(
  registry: ToolRegistry,
  ctx: ToolContext,
  scopes: string[],
  method: string,
  params: Record<string, unknown> = {},
) {
  const response = await handleMcpHttpRequest(
    new Request('http://localhost/api/v1/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
    { registry, ctx, scopes },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function resultOf(body: Record<string, unknown>): Record<string, unknown> {
  return (body['result'] ?? {}) as Record<string, unknown>;
}

describe('E17 MCP adapter', () => {
  it('E17: viewer-role key tools/list omits propose_action', async () => {
    const { port } = recordingProposer();
    const registry = new ToolRegistry(
      createDefaultTools({} as ToolDeps, { actionProposer: port }),
    );
    const { body } = await mcpRpc(registry, toolContext({ role: 'viewer' }), ['tools:read', 'tools:propose'], 'tools/list');
    const tools = (resultOf(body)['tools'] ?? []) as Array<{ name: string }>;
    const names = tools.map((tool) => tool.name);
    expect(names).toContain('get_revenue');
    expect(names).not.toContain(PROPOSE_ACTION_TOOL);
    expect(tools.find((tool) => tool.name === 'get_revenue')).toMatchObject({
      securitySchemes: [{ type: 'oauth2', scopes: ['tools:read'] }],
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    });
  });

  it('E17: propose_action advertises oauth2 tools:propose for ChatGPT discovery', async () => {
    const { port } = recordingProposer();
    const registry = new ToolRegistry(
      createDefaultTools({} as ToolDeps, { actionProposer: port }),
    );
    const { body } = await mcpRpc(registry, toolContext(), ['tools:read', 'tools:propose'], 'tools/list');
    const tools = (resultOf(body)['tools'] ?? []) as Array<{ name: string }>;
    expect(tools.find((tool) => tool.name === PROPOSE_ACTION_TOOL)).toMatchObject({
      securitySchemes: [{ type: 'oauth2', scopes: ['tools:propose'] }],
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    });
  });

  it('E17: tools/call get_revenue uses tenant from key not body', async () => {
    const registry = new ToolRegistry([revenueTool()]);
    const { body } = await mcpRpc(
      registry,
      toolContext(),
      ['tools:read'],
      'tools/call',
      { name: 'get_revenue', arguments: { tenantId: VICTIM } },
    );
    const result = resultOf(body);
    const text = ((result['content'] as Array<{ text?: string }>) ?? []).find((block) => block.text)?.text;
    const data = JSON.parse(text ?? '{}') as { tenantId: string; value: number };
    expect(data.tenantId).toBe(OWNER);
    expect(data.value).toBe(1500);
  });

  it('E17: body tenantId cannot switch tenant', async () => {
    const registry = new ToolRegistry([revenueTool()]);
    const { body } = await mcpRpc(
      registry,
      toolContext(),
      ['tools:read'],
      'tools/call',
      { name: 'get_revenue', arguments: { tenantId: VICTIM } },
    );
    const result = resultOf(body);
    const structured = result['structuredContent'] as { data?: { tenantId?: string; requested?: string | null } };
    expect(structured.data?.tenantId).toBe(OWNER);
    expect(structured.data?.requested).toBe(VICTIM);
    expect(structured.data?.tenantId).not.toBe(VICTIM);
  });

  it('E17: tools/call unknown tool isError NOT_FOUND', async () => {
    const registry = new ToolRegistry([revenueTool()]);
    const { body } = await mcpRpc(
      registry,
      toolContext(),
      ['tools:read'],
      'tools/call',
      { name: 'run_raw', arguments: {} },
    );
    const result = resultOf(body);
    expect(result['isError']).toBe(true);
    const text = JSON.stringify(result['content']);
    expect(text).toContain('NOT_FOUND');
  });

  it('E17: tools/call invalid args isError VALIDATION_ERROR', async () => {
    const registry = new ToolRegistry([
      defineTool({
        name: 'get_revenue',
        description: 'Receita',
        inputSchema: z.object({ from: z.string().datetime() }),
        async execute() {
          return { data: {}, sources: [] };
        },
      }),
    ]);
    const { body } = await mcpRpc(
      registry,
      toolContext(),
      ['tools:read'],
      'tools/call',
      { name: 'get_revenue', arguments: { from: 'not-a-date' } },
    );
    const result = resultOf(body);
    expect(result['isError']).toBe(true);
    expect(JSON.stringify(result['content'])).toContain(ErrorCode.VALIDATION_ERROR);
  });

  it('E17: propose_action via MCP origin mcp awaiting_approval no task', async () => {
    const { port, calls } = recordingProposer();
    const registry = new ToolRegistry(
      createDefaultTools({} as ToolDeps, { actionProposer: port }),
    );
    const { body } = await mcpRpc(
      registry,
      toolContext({ role: 'member' }),
      ['tools:read', 'tools:propose'],
      'tools/call',
      { name: 'propose_action', arguments: { actionType: 'create_task', input: { title: 'Ligar' } } },
    );
    const result = resultOf(body);
    expect(result['isError']).toBeFalsy();
    const structured = result['structuredContent'] as { data?: { status?: string }; proposal?: { status?: string } };
    expect(structured.data?.status ?? structured.proposal?.status).toBe('awaiting_approval');
    expect(calls[0]?.origin).toBe('mcp');
  });

  it('E17: tools/call without tools:propose scope cannot propose_action', async () => {
    const { port } = recordingProposer();
    const registry = new ToolRegistry(
      createDefaultTools({} as ToolDeps, { actionProposer: port }),
    );
    const { body } = await mcpRpc(
      registry,
      toolContext({ role: 'owner' }),
      ['tools:read'],
      'tools/call',
      { name: 'propose_action', arguments: { actionType: 'create_task', input: { title: 'Nope' } } },
    );
    const result = resultOf(body);
    expect(result['isError']).toBe(true);
    expect(JSON.stringify(result['content'])).toContain(ErrorCode.AUTHORIZATION_ERROR);
  });

  it('E17: McpConnector does not register a chat tool', () => {
    const names = createDefaultTools({} as ToolDeps).map((tool) => tool.name);
    expect(names).not.toContain('call_external_mcp');
  });
});
