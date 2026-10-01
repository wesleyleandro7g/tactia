import { answerMetadata, createChatRuntime, toToolContext } from '@tactia/chat/server';
import { createLLMAdapterFromEnv, type LLMAdapter } from '@tactia/ai';
import { createId } from '@tactia/shared';
import { chatServices } from './services';
import { schedulePort } from './schedules';
import { automationService } from './automations';

const automationPort = {
  async list(ctx: Parameters<typeof automationService.list>[0]) {
    const page = await automationService.list(ctx);
    return {
      items: page.items.map((item) => ({
        id: item.id,
        name: item.name,
        purpose: item.purpose,
        status: item.status,
      })),
    };
  },
  async get(ctx: Parameters<typeof automationService.get>[0], id: string) {
    const detail = await automationService.get(ctx, id);
    return {
      id: detail.automation.id,
      name: detail.automation.name,
      purpose: detail.automation.purpose,
      status: detail.automation.status,
      fields: (detail.version?.inputSchema.fields ?? []).map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        ...(field.enum ? { enum: field.enum } : {}),
      })),
    };
  },
  async run(
    ctx: Parameters<typeof automationService.start>[0],
    input: { automationId: string; params: Record<string, unknown>; idempotencyKey?: string },
  ) {
    const run = await automationService.start(ctx, {
      automationId: input.automationId,
      params: input.params,
      origin: 'agent',
      idempotencyKey: input.idempotencyKey ?? `agent:${createId()}`,
    });
    return { id: run.id, status: run.status, url: run.url, summary: run.summary };
  },
  async getRun(
    ctx: Parameters<typeof automationService.getRun>[0],
    input: { automationId: string; runId: string },
  ) {
    const run = await automationService.getRun(ctx, input.automationId, input.runId);
    return { id: run.id, status: run.status, url: run.url, summary: run.summary, error: run.error };
  },
};

const chatRuntime = createChatRuntime(chatServices, {
  schedulePort,
  automationPort,
  publicSearchApiKey: process.env.TAVILY_API_KEY,
});

/** MCP registry (no Browser Agent tools). */
export const toolRegistry = chatRuntime.toolRegistry;
export const contextBuilder = chatRuntime.contextBuilder;
export const getOrchestrator = chatRuntime.getOrchestrator;

/** Cheap classifier adapter (WhatsApp read-vs-operation routing). Null when no LLM key. */
let classifierAdapter: LLMAdapter | null | undefined;
export function getClassifierAdapter(): LLMAdapter | null {
  if (classifierAdapter === undefined) {
    classifierAdapter = createLLMAdapterFromEnv(
      {
        LLM_PROVIDER: process.env.LLM_PROVIDER,
        LLM_API_KEY: process.env.LLM_API_KEY,
        LLM_MODEL: process.env.LLM_MODEL,
        LLM_CLASSIFIER_MODEL: process.env.LLM_CLASSIFIER_MODEL,
        LLM_BASE_URL: process.env.LLM_BASE_URL,
      },
      'classifier',
    );
  }
  return classifierAdapter;
}

export { chatRuntime, answerMetadata, toToolContext };
