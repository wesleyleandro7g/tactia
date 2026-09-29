export { assertAuthenticated, assertTenantContext, assertTenantUser, assertRole, assertOwnerOrAdmin, assertOperator, assertTenantScope, assertOperatorForTenant, assertCanManageConnections, hasMinRole } from './authz';
export { AuditLogService, AuditAction } from './services/audit-log-service';
export { TenantService } from './services/tenant-service';
export { OperatorService } from './services/operator-service';
export { BackofficeService, type TenantSyncIndicator } from './services/backoffice-service';
export { UserService } from './services/user-service';
export { MembershipService } from './services/membership-service';
export { CustomerService } from './services/customer-service';
export { CustomFieldDefinitionService } from './services/custom-field-definition-service';
export { CustomDataValidationService } from './services/custom-data-validation-service';
export { DataCatalogService } from './services/data-catalog-service';
export { StructuredQueryService } from './services/structured-query-service';
export { LeadService } from './services/lead-service';
export { AcquisitionLeadService } from './services/acquisition-lead-service';
export { GoalService } from './services/goal-service';
export { BusinessFactService } from './services/business-fact-service';
export { EpisodeService } from './services/episode-service';
export { PlaybookService } from './services/playbook-service';
export { formatEpisodeText, entityFromActionInput } from './memory/format-episode-text';
export type { FormatEpisodeTextInput } from './memory/format-episode-text';
export {
  playbookStepSchema,
  playbookSlugSchema,
  createPlaybookSchema,
  updatePlaybookSchema,
  DEMO_PLAYBOOK_RECLAMACAO_ATRASO,
  playbookEmbeddingText,
} from './memory/playbook';
export type { PlaybookStep } from './memory/playbook';
export { CatalogEmbeddingService } from './services/catalog-embedding-service';
export { customerEmbeddingText, productEmbeddingText } from './memory/catalog-text';
export { chunkText, estimateTokens, CHUNK_TARGET_TOKENS, CHUNK_OVERLAP_TOKENS } from './services/chunker';
export { KnowledgeDocumentService } from './services/knowledge-document-service';
export { MediaIngestService } from './services/media-ingest-service';
export { InfographicService, type InfographicAttachment } from './services/infographic-service';
export { Utf8AndPdfExtractor, PDF_NO_TEXT } from './ports/document-extractor';
export type { DocumentTextExtractor } from './ports/document-extractor';
export type { VisionExtractor, AudioTranscriber, VisionClassification } from './ports/media';
export { VISION_UNAVAILABLE, STT_UNAVAILABLE } from './ports/media';
export {
  FACT_CONTEXT_K,
  FACT_CONTEXT_MIN_SCORE,
  EPISODE_SEARCH_LIMIT,
  PLAYBOOK_CONTEXT_K,
  EMBEDDING_DIMENSIONS,
  CHUNK_SEARCH_LIMIT,
  CATALOG_SEARCH_LIMIT,
} from '@tactia/database';
export { ExpenseService } from './services/expense-service';
export { PaymentService } from './services/payment-service';
export { InventoryService } from './services/inventory-service';
export { CampaignService } from './services/campaign-service';
export { ProductService } from './services/product-service';
export { SellerService } from './services/seller-service';
export { SaleService } from './services/sale-service';
export { ActivityService } from './services/activity-service';
export { InteractionService } from './services/interaction-service';
export { InteractionEnrichmentService } from './services/interaction-enrichment-service';
export { resolveProductMention } from './services/interaction-enrichment-service';
export type {
  InteractionClassifier,
  InteractionEmbedder,
  InteractionIntentLabel,
  InteractionUrgencyLabel,
  ClassifiedInteraction,
  ClassifierProduct,
} from './ports/interaction-enrichment';
export { INTERACTION_INTENTS, INTERACTION_URGENCIES } from './ports/interaction-enrichment';
export { INSIGHT_DISMISS_REASONS, type InsightDismissReason } from './services/insight-service';
export type {
  PipelineProviders,
  PipelineResult,
  RunPipelineOptions,
} from './services/intelligence-pipeline-service';
export { CredentialService, encrypt, decrypt } from './services/credential-service';
export {
  EmailConfigService,
  EMAIL_CREDENTIAL_PROVIDER,
  type StoredEmailConfig,
  type EmailConfigView,
} from './services/email-config-service';
export {
  emailConfigSchema,
  sendTestEmailSchema,
  SMTP_PROVIDER_ENUM,
  type EmailConfigInput,
  type SendTestEmailInput,
  type SmtpProviderId,
} from './schemas/email';
export { TenantApiKeyService } from './services/tenant-api-key-service';
export { trelloAuthFromCredential, trelloOAuthConfigFromEnv } from './services/trello-oauth-credential';
export type { VerifiedTenantApiKey } from './services/tenant-api-key-service';
export { WhatsappAuthorizedNumberService } from './services/whatsapp-authorized-number-service';
export { WhatsappAgentConfigService } from './services/whatsapp-agent-config-service';
export { WhatsappAgentJobService } from './services/whatsapp-agent-job-service';
export { normalizeWhatsappPhone, INVALID_WHATSAPP_PHONE } from './whatsapp/phone';
export {
  createWhatsappNumberSchema,
  updateWhatsappNumberSchema,
  whatsappAgentConfigSchema,
} from './schemas/whatsapp';
export {
  parseTenantApiKeyToken,
  generateTenantApiKeySecret,
  TOKEN_PREFIX,
} from './services/tenant-api-key-crypto';
export { createApiKeySchema, API_KEY_SCOPES } from './schemas/api-keys';
export type { ApiKeyScope } from './schemas/api-keys';
export { DataSourceService } from './services/data-source-service';
export { BrowserIntegrationService, currentBrowserEnvironment } from './services/browser-integration-service';
export { AgentSkillService, SkillResourceResolverRegistry, createSkillResourceRegistry, normalizeAgentSkillMarkdown, referencedSkillSlugs, agentSkillSlugSchema, createAgentSkillSchema, updateAgentSkillSchema, createAgentSkillBindingSchema } from './services/agent-skill-service';
export type { SkillResource, SkillResourceResolver } from './services/agent-skill-service';
export type { BrowserIntegrationDeps, BrowserSyncSnapshot, BrowserHealthResult } from './services/browser-integration-service';
export {
  createBrowserExecutorInstanceSchema,
  updateBrowserExecutorInstanceSchema,
  importBrowserWorkflowSchema,
  publishBrowserWorkflowSchema,
  testBrowserExecutorHealthSchema,
  setActiveRevisionSchema,
} from './schemas/browser-integration';
export type {
  ImportBrowserWorkflowInput,
  CreateBrowserExecutorInstanceRequest,
} from './schemas/browser-integration';
export { SyncService } from './services/sync-service';
export type { StartSyncOptions, SyncTenantSourcesOptions } from './services/sync-service';
export { ImportService } from './services/import-service';
export { MetricService } from './services/metric-service';
export { AnalyticsService } from './services/analytics-service';
export { SnapshotService } from './services/snapshot-service';
export {
  extractNumberTokens,
  canonicalizeNumber,
  collectAllowedFromValues,
  unsourcedNumbers,
  buildClaimAllowlist,
  PROSE_SMALL_INT_MAX,
} from './ai-safety/numbers';
export {
  BriefingService,
  collectAllowedNumbers,
  type BriefingNarrator,
  type BriefingFactSet,
} from './services/briefing-service';
export { InsightService } from './services/insight-service';
export { InsightFeedbackService } from './services/insight-feedback-service';
export { ThresholdCalibrator, RULE_THRESHOLD_KEY, loosenThreshold } from './services/threshold-calibrator';
export { RecommendationService } from './services/recommendation-service';
export { IntelligencePipelineService } from './services/intelligence-pipeline-service';
export { ConversationService } from './services/conversation-service';
export {
  ScheduleService,
  createScheduleSchema,
  updateScheduleSchema,
  type ScheduleServiceDeps,
  type CreateScheduleRequest,
  type UpdateScheduleRequest,
} from './services/schedule-service';
export {
  isDue,
  computePeriodKey,
  recurrenceConfigSchema,
  nthBusinessDayOfMonth,
  daysInMonth,
  isoWeek,
  localParts,
  scheduleFrequencyValues,
  type RecurrenceConfig,
  type ScheduleRecurrence,
  type ScheduleFrequencyValue,
} from './services/schedule-recurrence';
export type { AuthProvider } from './ports/auth-provider';
export {
  createTenantSchema,
  updateTenantSchema,
  createUserSchema,
  updateUserSchema,
  createMembershipSchema,
  updateMembershipSchema,
  provisionTenantSchema,
  operatorUpdateTenantSchema,
  operatorCreateSchema,
  backofficeListTenantsQuerySchema,
  resetPasswordSchema,
} from './schemas/identity';
export {
  createCustomerSchema,
  updateCustomerSchema,
  createLeadSchema,
  updateLeadSchema,
  createProductSchema,
  updateProductSchema,
  createSellerSchema,
  updateSellerSchema,
  createSaleSchema,
  updateSaleSchema,
  createActivitySchema,
  updateActivitySchema,
  createInteractionSchema,
  listInteractionQuerySchema,
  listQuerySchema,
} from './schemas/business';
export {
  createCustomFieldSchema,
  updateCustomFieldSchema,
  catalogQuerySchema,
  structuredQuerySchema,
  structuredAggregateSchema,
  flexibleEntityTypeSchema,
} from './schemas/custom-fields';
export {
  FLEXIBLE_ENTITY_TYPES,
  CUSTOM_FIELD_TYPES,
  CUSTOM_MAPPING_PREFIX,
  isCustomMappingTarget,
  customFieldKeyFromTarget,
  customMappingTarget,
} from './data-catalog/types';
export { ENTITY_TABLES, getEntitySpec } from './data-catalog/canonical-fields';
export {
  createDataSourceSchema,
  updateDataSourceSchema,
  createMappingSchema,
  updateMappingSchema,
  createCredentialSchema,
  previewQuerySchema,
  probeDataSourceSchema,
} from './schemas/data-platform';
export {
  SOURCE_KINDS,
  SQL_DIALECTS,
  getSourceKind,
  isKnownSourceKind,
  isSelectableSourceKind,
  isSqlDialect,
  defaultSqlPort,
  sqlDialectFromSource,
  sqlDialectLabel,
  sourceKindDisplayLabel,
  sourceKindHasConnector,
  listSelectableSourceKinds,
  groupSelectableSourceKinds,
} from './data-sources/catalog';
export type { SourceKind, CatalogField, CatalogFieldOption, SourceConnectorKind, SqlDialect } from './data-sources/catalog';
export {
  TARGET_ENTITIES,
  targetFieldsFor,
  guessMapping,
  sourceNameFromFile,
  customMappingFields,
} from './data-sources/import-mapping';
export type { MappingField, TargetEntity } from './data-sources/import-mapping';
export {
  createConversationSchema,
  listConversationsQuerySchema,
  sendMessageSchema,
  appendMessageSchema,
} from './schemas/ai';

export {
  buildTrelloAuthorizationUrl,
  computeChecksum,
  exchangeTrelloAuthorizationCode,
  generateTrelloOAuthState,
  generateTrelloPkce,
  sanitizeTrelloPayload,
  trelloCallbackUrl,
  verifyTrelloWebhookSignature,
} from '@tactia/connectors';

export {
  CommandCenterService,
  EvidenceGapService,
  createPlanSchema,
  updatePlanStatusSchema,
  createMeasurementReviewSchema,
  preparePlanFromRecommendationSchema,
  linkPlanExecutionSchema,
} from './services/command-center-service';

export {
  CommandCenterMetricsService,
  COMMAND_CENTER_METRICS_MAX_DAYS,
  COMMAND_CENTER_METRICS_DEFAULT_DAYS,
  UNSUPPORTED_PILOT_METRICS,
  resolveCommandCenterMetricsWindow,
} from './services/command-center-metrics-service';
export type {
  OperationalMetric,
  OperationalMetricAvailability,
  UnsupportedPilotMetric,
} from './services/command-center-metrics-service';

export {
  EvidenceClarificationService,
  prepareEvidenceClarificationSchema,
  clarificationResponseIsClear,
  evaluateClarificationPolicy,
} from './services/evidence-clarification-service';