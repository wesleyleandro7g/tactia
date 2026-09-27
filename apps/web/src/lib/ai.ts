import { answerMetadata, createChatRuntime, toToolContext } from '@tactia/chat/server';
import { createLLMAdapterFromEnv, type LLMAdapter } from '@tactia/ai';
import { chatServices } from './services';
import { schedulePort } from './schedules';

/**
 * AI wiring for the web app. Registry, context builder and orchestrator are
 * built by `@tactia/chat` on top of the shared chat services, so the admin
 * test chat runs exactly the same stack.
 */
const chatRuntime = createChatRuntime(chatServices, { schedulePort });

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
