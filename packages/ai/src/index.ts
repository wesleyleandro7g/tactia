export { ToolRegistry, defineTool } from './tool-registry';
export { ContextBuilder, type AiContext, type ContextBuilderDeps } from './context-builder';
export { buildSystemPrompt } from './system-prompt';
export {
  Orchestrator,
  type ChatRequest,
  type ContextSource,
  type OrchestratorConfig,
  type OrchestratorDeps,
} from './orchestrator';
export { VercelLLMAdapter, type VercelLLMAdapterConfig } from './adapters/vercel-llm-adapter';
export {
  MockLLMAdapter,
  type MockLLMAdapterOptions,
  type ScriptedTurn,
} from './adapters/mock-llm-adapter';
export {
  createLLMAdapterFromEnv,
  requireLLMAdapter,
  DEFAULT_LLM_MODEL,
  type LLMEnv,
} from './config';
export {
  createEmbeddingAdapterFromEnv,
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingEnv,
} from './embeddings/config';
export type { EmbeddingAdapter } from './embeddings/types';
export { MockEmbeddingAdapter } from './embeddings/mock-embedding-adapter';
export { OpenAIEmbeddingAdapter } from './embeddings/openai-embedding-adapter';
export {
  LlmInteractionClassifier,
  KeywordInteractionClassifier,
} from './classifiers/interaction-classifier';
export {
  createDefaultTools,
  createDefaultToolRegistry,
  createGetComplaintsTool,
  createGetCustomersTool,
  createGetInsightsTool,
  createGetProductsTool,
  createGetRevenueTool,
  createGetSalesTool,
  createGetSellersTool,
  createSearchInteractionsTool,
  createProposeActionTool,
  currentMonthPeriod,
  periodInputSchema,
  periodLabel,
  resolvePeriod,
  serializePeriod,
  sourceFromMetric,
  PROPOSABLE_ACTION_TYPES,
  type ActionProposalPort,
  type CreateToolsOptions,
  type ToolDeps,
} from './tools/index';
export type {
  ActionProposal,
  ChatAnswer,
  ChatStreamEvent,
  ChatTurn,
  ExecutedToolCall,
  LLMAdapter,
  LLMCompletion,
  LLMMessage,
  LLMRequest,
  LLMStreamChunk,
  LLMToolCall,
  LLMToolDefinition,
  LLMUsage,
  MessageSource,
  Tool,
  ToolContext,
  ToolResult,
} from './types';
