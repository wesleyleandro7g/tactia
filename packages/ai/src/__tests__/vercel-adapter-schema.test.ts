import { describe, expect, it } from 'vitest';
import { asSchema } from 'ai';
import { z } from 'zod';
import { toToolSet } from '../adapters/vercel-llm-adapter';

const request = (inputSchema: z.ZodTypeAny) => ({
  system: 'test',
  messages: [{ role: 'user' as const, content: 'test' }],
  tools: [{ name: 'browser_step', description: 'test', inputSchema }],
});

describe('VercelLLMAdapter tool schema materialization', () => {
  it('hands the provider an explicit JSON Schema object root', () => {
    const tools = toToolSet(request(z.object({
      type: z.enum(['click', 'wait']),
      target: z.string().optional(),
    }).strict()))!;
    const browserStep = tools['browser_step'] as { inputSchema: unknown };
    const schema = asSchema(browserStep.inputSchema as never).jsonSchema as { type?: string; required?: string[] };

    expect(schema.type).toBe('object');
    expect(schema.required).toContain('type');
  });

  it('rejects a non-object root locally instead of sending it to OpenAI', () => {
    const union = z.union([
      z.object({ type: z.literal('click'), target: z.string() }),
      z.object({ type: z.literal('wait'), seconds: z.number() }),
    ]);

    expect(() => toToolSet(request(union))).toThrow(
      "Schema interno inválido para a tool 'browser_step'",
    );
  });
});
