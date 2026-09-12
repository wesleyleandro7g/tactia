import { AppError, ErrorCode, isAppError, type MembershipRole } from '@tactia/shared';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolRegistry } from '../tool-registry';
import type { ToolContext } from '../types';

export const MCP_HTTP_ACCEPT = 'application/json, text/event-stream';
export const MCP_SERVER_NAME = 'tactia';
export const MCP_SERVER_VERSION = '0.1.0';
export const TOOLS_READ_SCOPE = 'tools:read';
export const TOOLS_PROPOSE_SCOPE = 'tools:propose';
export const PROPOSE_ACTION_TOOL = 'propose_action';

export type McpToolCallAudit = {
  tool: string;
  durationMs: number;
  error?: string;
};

export type HandleMcpHttpOptions = {
  registry: ToolRegistry;
  ctx: ToolContext;
  scopes: string[];
  onToolCall?: (event: McpToolCallAudit) => void;
};

/**
 * MCP adapter over the existing ToolRegistry.
 *
 * Uses the installed SDK (`@modelcontextprotocol/sdk` 1.30) Streamable HTTP
 * transport in stateless JSON mode — one fresh server+transport per request,
 * no second orchestrator, no session store.
 */
export async function handleMcpHttpRequest(
  request: Request,
  options: HandleMcpHttpOptions,
): Promise<Response> {
  const server = createRegistryMcpServer(options);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close().catch(() => undefined);
  }
}

function createRegistryMcpServer(options: HandleMcpHttpOptions): Server {
  const server = new Server(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const names = new Set(mcpVisibleToolNames(options.registry, options.ctx.role, options.scopes));
    return {
      tools: options.registry.definitions(options.ctx.role)
        .filter((tool) => names.has(tool.name))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: zodSchemaToJsonSchema(tool.inputSchema),
        })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    const started = Date.now();
    const allowed = mcpVisibleToolNames(options.registry, options.ctx.role, options.scopes);
    if (!allowed.includes(name)) {
      const code = options.registry.has(name) ? ErrorCode.AUTHORIZATION_ERROR : ErrorCode.NOT_FOUND;
      const message =
        code === ErrorCode.NOT_FOUND
          ? `NOT_FOUND: Tool '${name}' not found`
          : `AUTHORIZATION_ERROR: Tool '${name}' is not allowed for this key`;
      options.onToolCall?.({ tool: name, durationMs: Date.now() - started, error: code });
      return {
        isError: true,
        content: [{ type: 'text' as const, text: message }],
      };
    }

    try {
      const result = await options.registry.execute(name, options.ctx, args);
      options.onToolCall?.({ tool: name, durationMs: Date.now() - started });
      const payload = {
        data: result.data,
        sources: result.sources,
        ...(result.proposal ? { proposal: result.proposal } : {}),
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.data) }],
        structuredContent: payload,
        _meta: {
          sources: result.sources,
          ...(result.proposal ? { proposal: result.proposal } : {}),
        },
      };
    } catch (error) {
      const appError = toToolAppError(error, name);
      options.onToolCall?.({
        tool: name,
        durationMs: Date.now() - started,
        error: appError.code,
      });
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `${appError.code}: ${appError.message}` }],
      };
    }
  });

  return server;
}

export function mcpVisibleToolNames(
  registry: ToolRegistry,
  role: MembershipRole,
  scopes: string[],
): string[] {
  const names = registry.names(role);
  const canRead = scopes.includes(TOOLS_READ_SCOPE);
  const canPropose = scopes.includes(TOOLS_PROPOSE_SCOPE);
  return names.filter((name) => {
    if (name === PROPOSE_ACTION_TOOL) return canPropose;
    return canRead;
  });
}

function zodSchemaToJsonSchema(schema: z.ZodTypeAny): {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
} {
  const json = zodToJsonSchema(schema, { $refStrategy: 'none', target: 'jsonSchema7' }) as Record<
    string,
    unknown
  >;
  delete json.$schema;
  if (json.type !== 'object') {
    return { type: 'object', properties: {}, additionalProperties: true };
  }
  return json as {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

function toToolAppError(error: unknown, name: string): AppError {
  if (isAppError(error)) return error;
  return new AppError(ErrorCode.INTERNAL_ERROR, `Tool '${name}' failed`);
}
