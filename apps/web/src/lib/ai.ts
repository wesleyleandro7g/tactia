import {
  ContextBuilder,
  Orchestrator,
  ToolRegistry,
  createDefaultTools,
  requireLLMAdapter,
  type ActionProposalPort,
  type ChatAnswer,
  type ToolContext,
} from '@tactia/ai';
import { AppError, ErrorCode, redactSensitiveDeep, type RequestContext } from '@tactia/shared';
import {
  customerService,
  executionEngine,
  insightService,
  interactionService,
  metricService,
  analyticsService,
  briefingService,
  businessFactService,
  episodeService,
  playbookService,
  productService,
  recommendationService,
  saleService,
  sellerService,
  tenantService,
} from './services';
import { createEmbeddingAdapterFromEnv } from '@tactia/ai';

/**
 * Bridge between the AI layer and the Execution Engine: the assistant can only
 * *propose* an action, which lands in `awaiting_approval` (spec §44).
 */
const actionProposer: ActionProposalPort = {
  propose: (ctx, input) => executionEngine.proposeFromAi(ctx, input),
};

/**
 * The registry is the only path from the LLM to company data — no repository or
 * Prisma client is ever handed to the AI layer (spec §43).
 */
export const toolRegistry = new ToolRegistry(
  createDefaultTools(
    {
      metrics: metricService,
      analytics: analyticsService,
      customers: customerService,
      products: productService,
      sellers: sellerService,
      sales: saleService,
      insights: insightService,
      briefings: briefingService,
      facts: businessFactService,
      episodes: episodeService,
      playbooks: playbookService,
      recommendations: recommendationService,
      interactions: interactionService,
      embedder: createEmbeddingAdapterFromEnv({
        LLM_PROVIDER: process.env.LLM_PROVIDER,
        LLM_API_KEY: process.env.LLM_API_KEY,
        LLM_MODEL: process.env.LLM_MODEL,
        LLM_BASE_URL: process.env.LLM_BASE_URL,
        EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
      }),
    },
    { actionProposer },
  ),
);

export const contextBuilder = new ContextBuilder({
  tenants: tenantService,
  metrics: metricService,
  insights: insightService,
  providers: {
    goals: async (ctx) => {
      const items = await analyticsService.getGoalsProgress(ctx);
      return items.map((goal) => ({
        id: goal.id,
        metricKey: goal.metricKey,
        scope: goal.scope,
        scopeLabel: goal.scope === 'tenant' ? null : goal.scope,
        target: goal.target,
        achieved: goal.achieved,
        progress: goal.progress,
        requiredDailyPace: goal.requiredDailyPace,
        projected: goal.projected,
        onTrack: goal.onTrack,
        periodEnd: goal.periodEnd,
      }));
    },
    facts: async (ctx, query) => {
      const items = await businessFactService.forChatContext(ctx, query);
      return items.map((fact) => ({
        id: fact.id,
        kind: fact.kind,
        text: fact.text,
        validFrom: fact.validFrom?.toISOString() ?? null,
        validTo: fact.validTo?.toISOString() ?? null,
      }));
    },
    playbooks: async (ctx, query) => {
      const items = await playbookService.forChatContext(ctx, query);
      return items.map((playbook) => ({
        id: playbook.id,
        slug: playbook.slug,
        title: playbook.title,
        trigger: playbook.trigger,
      }));
    },
    briefing: async (ctx) => {
      const latest = await briefingService.latest(ctx);
      if (!latest) return null;
      const headline = latest.content.split('\n').find((line) => line.trim().length > 0) ?? 'Briefing semanal';
      return {
        id: latest.id,
        periodFrom: latest.periodFrom.toISOString(),
        periodTo: latest.periodTo.toISOString(),
        createdAt: latest.createdAt.toISOString(),
        headline: headline.replace(/^#+\s*/, '').slice(0, 160),
      };
    },
  },
});

let cachedOrchestrator: Orchestrator | null = null;

/**
 * Lazily built so the app boots without an LLM configured; chat routes then
 * answer `AI_ERROR` instead of crashing at import time.
 */
export function getOrchestrator(): Orchestrator {
  if (!cachedOrchestrator) {
    const llm = requireLLMAdapter(
      {
        LLM_PROVIDER: process.env.LLM_PROVIDER,
        LLM_API_KEY: process.env.LLM_API_KEY,
        LLM_MODEL: process.env.LLM_MODEL,
        LLM_CLASSIFIER_MODEL: process.env.LLM_CLASSIFIER_MODEL,
        LLM_BASE_URL: process.env.LLM_BASE_URL,
      },
      'chat',
    );
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
    ...(answer.followUps.length > 0 ? { followUps: answer.followUps } : {}),
    toolCalls: answer.toolCalls.map((call) => ({
      name: call.name,
      input: redactSensitiveDeep(call.input),
      durationMs: call.durationMs,
      ...(call.error ? { error: call.error } : {}),
    })),
    ...(answer.proposals.length > 0 ? { proposals: answer.proposals } : {}),
    provider: answer.provider,
    model: answer.model,
    ...(answer.usage ? { usage: answer.usage } : {}),
    ...(answer.guardrail ? { guardrail: answer.guardrail } : {}),
  };
}
