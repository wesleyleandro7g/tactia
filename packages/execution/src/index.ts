export { ActionRegistry, defineAction } from './action-registry';
export {
  createDefaultActions,
  createDefaultActionRegistry,
  type DefaultActionDeps,
} from './actions/index';
export { createTaskAction, createTaskInputSchema, type CreateTaskDeps } from './actions/create-task';
export { sendEmailAction, sendEmailInputSchema, type SendEmailDeps, type EmailArtifactResolver } from './actions/send-email';
export { ConsoleEmailSender, MemoryEmailSender } from './email-sender';
export {
  SmtpEmailSender,
  defaultSmtpTransportFactory,
  formatFromHeader,
  type ResolvedSmtpConfig,
  type SmtpTransport,
  type SmtpTransportFactory,
} from './smtp-email-sender';
export {
  SMTP_PROVIDER_PRESETS,
  SMTP_PROVIDER_IDS,
  getSmtpProviderPreset,
  resolveSmtpConnection,
  type SmtpProviderId,
  type SmtpProviderPreset,
  type ResolvedSmtpConnection,
} from './email-providers';
export {
  TenantAwareEmailSender,
  type EmailConfigResolver,
  type StoredEmailConfigLike,
  type TenantAwareEmailSenderOptions,
} from './tenant-aware-email-sender';
export { InlineJobQueue } from './job-queue';
export {
  PgBossJobQueue,
  ACTION_EXECUTE_JOB,
  DEFAULT_JOB_RETRY_LIMIT,
  type ActionExecuteJob,
  type JobHandler,
  type PgBossJobQueueOptions,
  type PublishOptions,
} from './pg-boss-job-queue';
export { ExecutionEngine, type ExecutionEngineDeps, type EpisodeSink } from './execution-engine';
export {
  ScheduleRunner,
  type ScheduleRunnerDeps,
  type ScheduleAgentRunner,
} from './schedule-runner';
export { ActionService } from './action-service';
export { ApprovalService } from './approval-service';
export { AutomationService, type AutomationServiceDeps, type StartAutomationInput } from './automations/service';
export { PrismaAutomationStore } from './automations/prisma-store';
export { loadAutomationAttachments } from './automations/attachments';
export { createReportsPortalBrowser } from './automations/reports-browser';
export { createPublishedWorkflowRunner } from './automations/figranium-runner';
export { EmailDeliveryUncertainError, isUncertainEmailError } from './automations/email-uncertainty';
export type { AutomationBrowserPort, BrowserExportResult, EffectProposal } from './automations/ports';
export { effectProposalFromAction } from './automations/ports';
export type { ScheduleAutomationRunner } from './schedule-runner';
export {
  ACTION_TYPES,
  approvalDecisionSchema,
  createActionSchema,
  listActionsQuerySchema,
  listApprovalsQuerySchema,
  listExecutionsQuerySchema,
  proposeActionSchema,
  updateActionSchema,
} from './schemas';
export type {
  ActionDefinition,
  ActionExecutorContext,
  ActionOutput,
  EmailMessage,
  EmailSendResult,
  EmailSender,
  EmailSendContext,
  ExecutionOrigin,
  JobQueue,
  ProposeActionInput,
} from './types';
