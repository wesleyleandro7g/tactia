import { answerMetadata, createChatRuntime, toToolContext } from '@tactia/chat/server';
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
export { chatRuntime, answerMetadata, toToolContext };
