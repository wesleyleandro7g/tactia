/**
 * Tool Registry unit tests — validation, error classification and the V0.1 tool set.
 * No database and no LLM involved.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, ErrorCode, createId, type RequestContext } from '@tactia/shared';
import { ToolRegistry, defineTool } from '../tool-registry';
import type { ToolContext } from '../types';

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

const echoTool = defineTool({
  name: 'echo',
  description: 'Repeats the given number of times.',
  inputSchema: z.object({ times: z.number().int().min(1).max(5).default(1) }),
  async execute(_ctx, input) {
    return { data: { times: input.times }, sources: [] };
  },
});

describe('ToolRegistry', () => {
  it('registers and lists tools', () => {
    const registry = new ToolRegistry([echoTool]);
    expect(registry.names()).toEqual(['echo']);
    expect(registry.has('echo')).toBe(true);
    expect(registry.definitions()).toHaveLength(1);
    expect(registry.definitions()[0]?.description).toContain('Repeats');
  });

  it('rejects duplicated tool names with CONFLICT', () => {
    const registry = new ToolRegistry([echoTool]);
    try {
      registry.register(echoTool);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.CONFLICT);
    }
  });

  it('returns NOT_FOUND for an unknown tool', async () => {
    const registry = new ToolRegistry([echoTool]);
    await expect(registry.execute('get_secrets', toolContext(), {})).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('validates input with Zod before executing (VALIDATION_ERROR)', async () => {
    const registry = new ToolRegistry([echoTool]);
    await expect(registry.execute('echo', toolContext(), { times: 99 })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
    });
  });

  it('applies schema defaults when the model omits fields', async () => {
    const registry = new ToolRegistry([echoTool]);
    const result = await registry.execute('echo', toolContext(), {});
    expect(result.data).toEqual({ times: 1 });
  });
});
