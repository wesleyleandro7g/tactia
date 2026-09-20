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
export const GET_PROFILE_TOOL = 'get_profile';

/** Direct-write tools stay off the ChatGPT surface; propose_action is the only mutation path. */
const MCP_HIDDEN_TOOLS = new Set(['remember_fact', 'generate_infographic']);

export type McpToolCallAudit = {
  tool: string;
  durationMs: number;
  error?: string;
};

export type McpProfile = {
  id: string;
  name: string;
  email: string;
  nickname: string;
};

export type HandleMcpHttpOptions = {
  registry: ToolRegistry;
  ctx: ToolContext;
  scopes: string[];
  /** When set, publishes the ChatGPT `get_profile` tool for the authorized membership. */
  profile?: McpProfile;
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
    const tools = options.registry
      .definitions(options.ctx.role)
      .filter((tool) => names.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: zodSchemaToJsonSchema(tool.inputSchema),
        ...mcpToolAuthMetadata(tool.name),
      }));

    if (options.profile && options.scopes.includes(TOOLS_READ_SCOPE)) {
      tools.unshift({
        name: GET_PROFILE_TOOL,
        description: 'Perfil da membership autorizada nesta conexão MCP.',
        inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
        ...mcpToolAuthMetadata(GET_PROFILE_TOOL),
      });
    }

    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    const started = Date.now();

    if (name === GET_PROFILE_TOOL) {
      if (!options.profile || !options.scopes.includes(TOOLS_READ_SCOPE)) {
        options.onToolCall?.({
          tool: name,
          durationMs: Date.now() - started,
          error: ErrorCode.AUTHORIZATION_ERROR,
        });
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `AUTHORIZATION_ERROR: Tool '${name}' is not allowed for this key` }],
        };
      }
      options.onToolCall?.({ tool: name, durationMs: Date.now() - started });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(options.profile) }],
        structuredContent: options.profile,
        _meta: { 'openai/profile': options.profile },
      };
    }

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

/** ChatGPT discovers tools before attaching a bearer; these RPCs stay public. */
export const PUBLIC_MCP_METHODS = new Set([
  'initialize',
  'notifications/initialized',
  'tools/list',
  'ping',
]);

export function isPublicMcpMethod(method: string | null | undefined): boolean {
  return Boolean(method && PUBLIC_MCP_METHODS.has(method));
}

function mcpToolAuthMetadata(name: string): {
  securitySchemes: Array<{ type: 'oauth2'; scopes: string[] }>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean };
} {
  const write = name === PROPOSE_ACTION_TOOL;
  return {
    securitySchemes: [{
      type: 'oauth2',
      scopes: [write ? TOOLS_PROPOSE_SCOPE : TOOLS_READ_SCOPE],
    }],
    annotations: {
      readOnlyHint: !write,
      destructiveHint: false,
      openWorldHint: false,
    },
  };
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
    if (MCP_HIDDEN_TOOLS.has(name)) return false;
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
