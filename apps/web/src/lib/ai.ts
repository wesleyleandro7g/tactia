import {
  ContextBuilder,
  Orchestrator,
  ToolRegistry,
  createDefaultTools,
  requireLLMAdapter,
  type ChatAnswer,
  type ToolContext,
} from '@tactia/ai';
import { AppError, ErrorCode, type RequestContext } from '@tactia/shared';
import {
  customerService,
  insightService,
  metricService,
  productService,
  recommendationService,
  saleService,
  sellerService,
  tenantService,
} from './services';

/**
 * The registry is the only path from the LLM to company data — no repository or
 * Prisma client is ever handed to the AI layer (spec §43).
 */
export const toolRegistry = new ToolRegistry(
  createDefaultTools({
    metrics: metricService,
    customers: customerService,
    products: productService,
    sellers: sellerService,
    sales: saleService,
    insights: insightService,
    recommendations: recommendationService,
  }),
);

export const contextBuilder = new ContextBuilder({
  tenants: tenantService,
  metrics: metricService,
  insights: insightService,
});

let cachedOrchestrator: Orchestrator | null = null;

/**
 * Lazily built so the app boots without an LLM configured; chat routes then
 * answer `AI_ERROR` instead of crashing at import time.
 */
export function getOrchestrator(): Orchestrator {
  if (!cachedOrchestrator) {
    const llm = requireLLMAdapter({
      LLM_PROVIDER: process.env.LLM_PROVIDER,
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_MODEL: process.env.LLM_MODEL,
      LLM_BASE_URL: process.env.LLM_BASE_URL,
    });
    cachedOrchestrator = new Orchestrator({ llm, tools: toolRegistry, contextBuilder });
  }
  return cachedOrchestrator;
}

/** Narrows the request context for the AI layer — tenant always from session. */
export function toToolContext(ctx: RequestContext): ToolContext {
  if (!ctx.tenantId || !ctx.userId || !ctx.role) {
    throw new AppError(ErrorCode.AUTHORIZATION_ERROR, 'An active tenant is required');
  }
  return { ...ctx, tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role };
}

/** Metadata persisted on the assistant message (evidence per spec §43). */
export function answerMetadata(answer: ChatAnswer) {
  return {
    sources: answer.sources,
    toolCalls: answer.toolCalls.map((call) => ({
      name: call.name,
      input: call.input,
      durationMs: call.durationMs,
      ...(call.error ? { error: call.error } : {}),
    })),
    provider: answer.provider,
    model: answer.model,
    ...(answer.usage ? { usage: answer.usage } : {}),
    ...(answer.guardrail ? { guardrail: answer.guardrail } : {}),
  };
}
