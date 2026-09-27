export { ActionRegistry, defineAction } from './action-registry';
export {
  createDefaultActions,
  createDefaultActionRegistry,
  type DefaultActionDeps,
} from './actions/index';
export { createTaskAction, createTaskInputSchema, type CreateTaskDeps } from './actions/create-task';
export { sendEmailAction, sendEmailInputSchema, type SendEmailDeps } from './actions/send-email';
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
export { ActionService } from './action-service';
export { ApprovalService } from './approval-service';
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
