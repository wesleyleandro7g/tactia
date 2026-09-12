import { ZodError, type z } from 'zod';
import { hasMinRole } from '@tactia/domain';
import { AppError, ErrorCode, logger, type MembershipRole } from '@tactia/shared';
import type { LLMToolDefinition, Tool, ToolContext, ToolResult } from './types';

/**
 * Helper to author a tool with a typed input while keeping the registry
 * homogeneous. Input is parsed with Zod before `execute` receives it, so tools
 * never see unvalidated LLM output (spec §45).
 */
export function defineTool<TSchema extends z.ZodTypeAny, TData>(definition: {
  name: string;
  description: string;
  inputSchema: TSchema;
  minRole?: MembershipRole;
  execute: (context: ToolContext, input: z.infer<TSchema>) => Promise<ToolResult<TData>>;
}): Tool {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    ...(definition.minRole ? { minRole: definition.minRole } : {}),
    async execute(context: ToolContext, input: unknown) {
      const parsed = definition.inputSchema.parse(input ?? {}) as z.infer<TSchema>;
      return definition.execute(context, parsed);
    },
  };
}

/**
 * Tool Registry (spec §42).
 *
 * The registry is the *only* door between the LLM and company data: there is no
 * generic "run SQL" tool and no repository is exposed. Everything a tool does
 * goes through domain services with the tenant taken from the session.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(tools: Tool[] = []) {
    for (const tool of tools) this.register(tool);
  }

  register(tool: Tool): this {
    if (this.tools.has(tool.name)) {
      throw new AppError(ErrorCode.CONFLICT, `Tool '${tool.name}' is already registered`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) throw new AppError(ErrorCode.NOT_FOUND, `Tool '${name}' not found`);
    return tool;
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  /** When `role` is omitted, every registered tool is visible (legacy tests). */
  names(role?: MembershipRole): string[] {
    return this.visible(role).map((tool) => tool.name);
  }

  /**
   * Tool definitions handed to the LLM adapter.
   * When `role` is omitted, behaviour matches the pre-role registry (all tools).
   */
  definitions(role?: MembershipRole): LLMToolDefinition[] {
    return this.visible(role).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  private visible(role?: MembershipRole): Tool[] {
    if (!role) return this.list();
    return this.list().filter((tool) => hasMinRole(role, tool.minRole ?? 'viewer'));
  }

  /**
   * Validate + execute a tool call.
   * Invalid input becomes `VALIDATION_ERROR`; unknown tool becomes `NOT_FOUND`;
   * a tool above the caller's role becomes `AUTHORIZATION_ERROR`.
   */
  async execute(name: string, context: ToolContext, input: unknown): Promise<ToolResult> {
    const tool = this.get(name);
    const minRole = tool.minRole ?? 'viewer';
    if (context.role && !hasMinRole(context.role, minRole)) {
      throw new AppError(
        ErrorCode.AUTHORIZATION_ERROR,
        `Tool '${name}' requires role ${minRole}`,
      );
    }
    const started = Date.now();

    try {
      const result = await tool.execute(context, input);
      logger.info({
        request_id: context.requestId,
        tenant_id: context.tenantId,
        user_id: context.userId,
        operation: `tool:${name}`,
        duration_ms: Date.now() - started,
        status: 200,
      });
      return result;
    } catch (error) {
      if (error instanceof ZodError) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Invalid input for tool '${name}'`,
          error.flatten(),
        );
      }
      logger.info({
        request_id: context.requestId,
        tenant_id: context.tenantId,
        user_id: context.userId,
        operation: `tool:${name}`,
        duration_ms: Date.now() - started,
        status: error instanceof AppError ? error.statusCode : 500,
        error: error instanceof AppError ? error.code : 'TOOL_ERROR',
      });
      throw error;
    }
  }
}
