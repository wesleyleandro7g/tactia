import {
  ActionExecutionRepository,
  AgentSkillRepository,
  ActionRepository,
  ActivityRepository,
  ApprovalRepository,
  AuditLogRepository,
  BriefingRepository,
  BusinessFactRepository,
  ConversationRepository,
  CredentialRepository,
  CustomFieldDefinitionRepository,
  CustomerRepository,
  EpisodeRepository,
  InfographicAssetRepository,
  InsightRepository,
  InteractionRepository,
  KnowledgeDocumentRepository,
  LeadRepository,
  MembershipRepository,
  MessageRepository,
  MetricRepository,
  PlaybookRepository,
  ProductRepository,
  RecommendationRepository,
  SaleRepository,
  SellerRepository,
  StructuredQueryRepository,
  TenantRepository,
  type PrismaClient,
} from '@tactia/database';
import {
  AgentSkillService,
  AnalyticsService,
  AuditLogService,
  BriefingService,
  BusinessFactService,
  CatalogEmbeddingService,
  CustomDataValidationService,
  CustomerService,
  DataCatalogService,
  EmailConfigService,
  EpisodeService,
  InfographicService,
  InsightService,
  InteractionEnrichmentService,
  InteractionService,
  KnowledgeDocumentService,
  MetricService,
  PlaybookService,
  ProductService,
  RecommendationService,
  SaleService,
  SellerService,
  StructuredQueryService,
  TenantService,
  createSkillResourceRegistry,
} from '@tactia/domain';
import { MetricEngine, SnapshotEngine } from '@tactia/intelligence';
import {
  ActionService,
  ApprovalService,
  ConsoleEmailSender,
  ExecutionEngine,
  TenantAwareEmailSender,
  createDefaultActionRegistry,
  defineAction,
  type EmailArtifactResolver,
  type EmailSender,
  type JobQueue,
} from '@tactia/execution';
import {
  KeywordInteractionClassifier,
  LlmInteractionClassifier,
  createEmbeddingAdapterFromEnv,
  createLLMAdapterFromEnv,
} from '@tactia/ai';
import { logger, type RequestContext } from '@tactia/shared';
import { createObjectStorageFromEnv, type ObjectStorage } from '@tactia/shared/storage';
import { z } from 'zod';
import { BrowserAutomationService, type BrowserTaskQueue } from './browser/automation';

/** LLM/embedding env read by the chat stack (never sent to the client). */
export type ChatEnv = {
  LLM_PROVIDER?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_CLASSIFIER_MODEL?: string;
  LLM_BASE_URL?: string;
  EMBEDDING_MODEL?: string;
};

export function chatEnvFromProcess(): ChatEnv {
  return {
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_CLASSIFIER_MODEL: process.env.LLM_CLASSIFIER_MODEL,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
  };
}

/** A chat is usable only with an LLM provider configured (or the mock). */
export function isLlmConfigured(env: ChatEnv = chatEnvFromProcess()): boolean {
  return Boolean(env.LLM_API_KEY) || env.LLM_PROVIDER === 'mock';
}

export type CreateChatServicesInput = {
  prisma: PrismaClient;
  env?: ChatEnv;
  storage?: ObjectStorage;
  /** Queue for action executions; falls back to inline execution when absent. */
  executionQueue?: JobQueue;
  /** Publish-only queue for Browser Agent tasks (run by the web worker). */
  browserQueue: () => BrowserTaskQueue | null;
  /** Async document ingestion (web job queue); inline when absent. */
  enqueueDocumentIngest?: (job: { tenantId: string; documentId: string }) => Promise<void>;
  emailSender?: EmailSender;
  emailArtifactResolver?: EmailArtifactResolver;
};

/**
 * Single composition of every service the Tactia chat needs (tools, context,
 * execution, Browser Agent). Shared by apps/web and apps/admin so both chats
 * run exactly the same stack; each app adds its own services on top.
 */
export function createChatServices(input: CreateChatServicesInput) {
  const { prisma } = input;
  const env = input.env ?? chatEnvFromProcess();

  // Repositories -------------------------------------------------------------
  const repositories = {
    tenants: new TenantRepository(prisma),
    memberships: new MembershipRepository(prisma),
    auditLogs: new AuditLogRepository(prisma),
    customers: new CustomerRepository(prisma),
    leads: new LeadRepository(prisma),
    products: new ProductRepository(prisma),
    sellers: new SellerRepository(prisma),
    sales: new SaleRepository(prisma),
    activities: new ActivityRepository(prisma),
    businessFacts: new BusinessFactRepository(prisma),
    episodes: new EpisodeRepository(prisma),
    playbooks: new PlaybookRepository(prisma),
    knowledgeDocuments: new KnowledgeDocumentRepository(prisma),
    infographicAssets: new InfographicAssetRepository(prisma),
    customFieldDefinitions: new CustomFieldDefinitionRepository(prisma),
    interactions: new InteractionRepository(prisma),
    metrics: new MetricRepository(prisma),
    insights: new InsightRepository(prisma),
    briefings: new BriefingRepository(prisma),
    recommendations: new RecommendationRepository(prisma),
    actions: new ActionRepository(prisma),
    actionExecutions: new ActionExecutionRepository(prisma),
    approvals: new ApprovalRepository(prisma),
    agentSkills: new AgentSkillRepository(prisma),
    conversations: new ConversationRepository(prisma),
    messages: new MessageRepository(prisma),
  };

  // Adapters -----------------------------------------------------------------
  const objectStorage = input.storage ?? createObjectStorageFromEnv();
  const embeddingAdapter = createEmbeddingAdapterFromEnv({
    LLM_PROVIDER: env.LLM_PROVIDER,
    LLM_API_KEY: env.LLM_API_KEY,
    LLM_MODEL: env.LLM_MODEL,
    LLM_BASE_URL: env.LLM_BASE_URL,
    EMBEDDING_MODEL: env.EMBEDDING_MODEL,
  });
  // Classification runs over thousands of short messages: cheaper tier.
  const classifierAdapter = createLLMAdapterFromEnv(
    {
      LLM_PROVIDER: env.LLM_PROVIDER,
      LLM_API_KEY: env.LLM_API_KEY,
      LLM_MODEL: env.LLM_MODEL,
      LLM_CLASSIFIER_MODEL: env.LLM_CLASSIFIER_MODEL,
      LLM_BASE_URL: env.LLM_BASE_URL,
    },
    'classifier',
  );
  const narratorAdapter = createLLMAdapterFromEnv(
    {
      LLM_PROVIDER: env.LLM_PROVIDER,
      LLM_API_KEY: env.LLM_API_KEY,
      LLM_MODEL: env.LLM_MODEL,
      LLM_BASE_URL: env.LLM_BASE_URL,
    },
    'chat',
  );

  // Domain services ------------------------------------------------------------
  const auditLogService = new AuditLogService(repositories.auditLogs);
  const agentSkillService = new AgentSkillService(
    repositories.agentSkills,
    createSkillResourceRegistry(prisma),
    auditLogService,
  );
  const tenantService = new TenantService(
    repositories.tenants,
    repositories.memberships,
    auditLogService,
  );
  const catalogEmbeddingService = new CatalogEmbeddingService(
    repositories.products,
    repositories.customers,
    embeddingAdapter,
  );
  const customDataValidationService = new CustomDataValidationService(
    repositories.customFieldDefinitions,
  );
  const dataCatalogService = new DataCatalogService(repositories.customFieldDefinitions);
  const structuredQueryService = new StructuredQueryService(
    dataCatalogService,
    new StructuredQueryRepository(prisma),
  );
  const customerService = new CustomerService(
    repositories.customers,
    auditLogService,
    catalogEmbeddingService,
    customDataValidationService,
  );
  const productService = new ProductService(
    repositories.products,
    auditLogService,
    catalogEmbeddingService,
    customDataValidationService,
  );
  const sellerService = new SellerService(repositories.sellers, auditLogService);
  const saleService = new SaleService(
    repositories.sales,
    repositories.customers,
    repositories.products,
    repositories.sellers,
    auditLogService,
    customDataValidationService,
  );
  const businessFactService = new BusinessFactService(repositories.businessFacts, embeddingAdapter);
  const episodeService = new EpisodeService(repositories.episodes, embeddingAdapter);
  const playbookService = new PlaybookService(
    repositories.playbooks,
    auditLogService,
    embeddingAdapter,
  );

  const interactionClassifier =
    env.LLM_PROVIDER === 'mock'
      ? new KeywordInteractionClassifier()
      : classifierAdapter
        ? new LlmInteractionClassifier(classifierAdapter)
        : null;
  const interactionEnrichmentService = new InteractionEnrichmentService({
    interactions: repositories.interactions,
    classifier: interactionClassifier,
    embedder: embeddingAdapter,
    products: repositories.products,
  });
  const interactionService = new InteractionService(
    repositories.interactions,
    repositories.customers,
    auditLogService,
    interactionEnrichmentService,
  );

  const knowledgeDocumentService: KnowledgeDocumentService = new KnowledgeDocumentService({
    documents: repositories.knowledgeDocuments,
    storage: objectStorage,
    auditLogs: auditLogService,
    embedder: embeddingAdapter,
    enqueueIngest: input.enqueueDocumentIngest,
  });
  const infographicService = new InfographicService(repositories.infographicAssets, objectStorage);

  const metricEngine = new MetricEngine(prisma);
  const metricService = new MetricService(metricEngine, repositories.metrics);
  // One snapshot engine shared by analytics (trends), the pipeline (baselines) and jobs.
  const snapshotEngine = new SnapshotEngine(prisma, metricEngine);
  const analyticsService = new AnalyticsService(prisma, snapshotEngine);
  const insightService = new InsightService(repositories.insights);
  const briefingService = new BriefingService(
    prisma,
    repositories.briefings,
    narratorAdapter
      ? {
          narrate: async ({ system, user }) => {
            const result = await narratorAdapter.complete({
              system,
              messages: [{ role: 'user', content: user }],
              temperature: 0.3,
              maxOutputTokens: 1200,
            });
            return { text: result.text, model: narratorAdapter.model };
          },
        }
      : null,
  );
  const recommendationService = new RecommendationService(
    repositories.recommendations,
    auditLogService,
  );

  // Execution ------------------------------------------------------------------
  // Executors receive repositories, not services: an execution may run after
  // the request that proposed it. Authorization happens on propose/approve.
  //
  // Email: each tenant may configure its own SMTP mailbox (managed in Tactia
  // Ops). The tenant-aware sender resolves that config at send time and falls
  // back to console logging for tenants without email. Tests can inject a
  // deterministic sender via `input.emailSender`.
  const emailConfigService = new EmailConfigService(new CredentialRepository(prisma));
  const emailSender =
    input.emailSender ??
    new TenantAwareEmailSender({
      resolve: (tenantId) => emailConfigService.getResolvedForTenant(tenantId),
      fallback: new ConsoleEmailSender(),
    });
  const actionRegistry = createDefaultActionRegistry({
    activities: repositories.activities,
    customers: repositories.customers,
    leads: repositories.leads,
    sellers: repositories.sellers,
    emailSender,
    ...(input.emailArtifactResolver ? { artifactResolver: input.emailArtifactResolver } : {}),
  });

  const executionEngine = new ExecutionEngine({
    actions: repositories.actions,
    executions: repositories.actionExecutions,
    approvals: repositories.approvals,
    registry: actionRegistry,
    auditLogs: auditLogService,
    queue: input.executionQueue,
    episodes: {
      record: async (episode) => {
        await episodeService.record(episode);
      },
    },
  });

  type BrowserResultElaborator = (input: {
    tenantId: string;
    conversationId: string;
    taskId: string;
    objective: string;
    content: string;
    summary: string;
    extractionText?: string | null;
    requestedBy?: string | null;
    success: boolean;
  }) => Promise<{ content: string; followUps?: string[]; sources?: unknown[] }>;
  let elaborateBrowserResult: BrowserResultElaborator | null = null;

  const browserAutomationService = new BrowserAutomationService({
    queue: input.browserQueue,
    executionEngine: () => executionEngine,
    storage: objectStorage,
    agentSkills: agentSkillService,
    resultPublisher: {
      async publish(input) {
        const conversation = await repositories.conversations.findById({
          tenantId: input.tenantId,
          id: input.conversationId,
        });
        if (!conversation) return null;
        let content = input.content;
        let followUps: string[] = [];
        let sources: unknown[] = [];
        if (elaborateBrowserResult) {
          try {
            const elaborated = await elaborateBrowserResult(input);
            if (elaborated.content.trim()) {
              content = elaborated.content;
              followUps = elaborated.followUps ?? [];
              sources = elaborated.sources ?? [];
            }
          } catch (error) {
            logger.error({
              operation: 'browser_result_elaboration_failed',
              tenant_id: input.tenantId,
              task_id: input.taskId,
              error_message: error instanceof Error ? error.message : 'unknown',
            });
          }
        }
        const message = await repositories.messages.createBrowserResult({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          browserTaskId: input.taskId,
          content,
          metadata: {
            browserResultTaskId: input.taskId,
            browserResult: {
              taskId: input.taskId,
              objective: input.objective,
              summary: input.summary,
            },
            ...(followUps.length > 0 ? { followUps } : {}),
            toolCalls: [{ name: 'browser_agent' }],
            sources,
          },
        });
        await repositories.conversations.touch({
          tenantId: input.tenantId,
          id: input.conversationId,
        });
        return message;
      },
    },
  });

  // The engine reads the registry at execution time, so late registration is safe.
  actionRegistry.register(
    defineAction({
      type: 'browser_action',
      name: 'Confirmar ação no navegador (legado)',
      description:
        'Somente para aprovações criadas antes do modo autônomo do Browser Agent: encerra a tarefa antiga para que seja solicitada novamente.',
      defaultRequiresApproval: true,
      inputSchema: z.object({ taskId: z.string().uuid() }),
      async execute(ctx, actionInput) {
        return browserAutomationService.resumeApproved(ctx.tenantId, actionInput.taskId, ctx.executionId);
      },
    }),
  );

  const actionService = new ActionService(
    repositories.actions,
    repositories.actionExecutions,
    actionRegistry,
    auditLogService,
  );
  const approvalService = new ApprovalService(repositories.approvals, executionEngine);

  /**
   * Rejects an approval; legacy Browser Agent approvals also retire their task.
   * Same behaviour for every app that exposes approvals.
   */
  async function rejectApproval(ctx: RequestContext, approvalId: string, body: unknown) {
    const execution = await approvalService.reject(ctx, approvalId, body ?? {});
    if (execution.action.type === 'browser_action' && ctx.tenantId) {
      const actionInput = execution.input as { taskId?: string };
      if (actionInput.taskId) {
        await browserAutomationService.rejectPending(ctx.tenantId, actionInput.taskId, execution.id);
      }
    }
    return execution;
  }

  return {
    env,
    repositories,
    objectStorage,
    embeddingAdapter,
    classifierAdapter,
    metricEngine,
    snapshotEngine,
    emailSender,
    actionRegistry,
    auditLogService,
    agentSkillService,
    tenantService,
    catalogEmbeddingService,
    customDataValidationService,
    dataCatalogService,
    structuredQueryService,
    customerService,
    productService,
    sellerService,
    saleService,
    businessFactService,
    episodeService,
    playbookService,
    interactionEnrichmentService,
    interactionService,
    knowledgeDocumentService,
    infographicService,
    metricService,
    analyticsService,
    insightService,
    briefingService,
    recommendationService,
    executionEngine,
    actionService,
    approvalService,
    browserAutomationService,
    rejectApproval,
    bindBrowserResultElaborator(elaborator: BrowserResultElaborator) {
      elaborateBrowserResult = elaborator;
    },
  };
}

export type ChatServices = ReturnType<typeof createChatServices>;
