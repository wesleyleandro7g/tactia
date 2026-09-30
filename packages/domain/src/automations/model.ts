export const AUTOMATION_ORIGINS = ['page', 'agent', 'schedule', 'webhook', 'internal_event'] as const;
export type AutomationOriginName = (typeof AUTOMATION_ORIGINS)[number];

export const REPORT_KEYS = ['sales', 'inventory', 'financial'] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const REPORTS_PORTAL_COMPONENT_KEY = 'reports.portal.v1';
export const REPORTS_PORTAL_TEMPLATE_KEY = 'reports.portal';
export const REPORTS_PORTAL_WORKFLOW_KEY = 'tactia.reports-portal';
export const REPORTS_PORTAL_WORKFLOW_VERSION = '1';
export const SYNC_COMPLETED_EVENT = 'sync.completed';

export type AutomationInputField = {
  key: string;
  label: string;
  type: 'date' | 'email' | 'string' | 'string[]';
  required: boolean;
  enum?: string[];
  /** Cliente admin pode definir o valor padrão deste campo. */
  released?: boolean;
};

export type AutomationInputSchema = {
  fields: AutomationInputField[];
};

export type AutomationStepDefinition = {
  key: string;
  kind: 'browser_workflow' | 'validate_reports' | 'send_email';
  /** Só operações seguras podem ser repetidas automaticamente. */
  retryable: boolean;
  workflowKey?: string;
  workflowVersion?: string;
  /** Revisão fixada na publicação. Execuções usam esta revisão, não a ativa. */
  revisionId?: string;
  connectionId?: string;
};

export type EmailEffectPolicy = {
  preauthorizedRecipients: string[];
  approvalRecipients: string[];
};

export type AuthorizationPolicy = {
  connections: string[];
  requireRealTransport?: boolean;
  effects: {
    send_email?: EmailEffectPolicy;
  };
};

export type PageBlock =
  | { type: 'form'; title: string; fields?: string[] }
  | { type: 'metrics'; title: string }
  | { type: 'table'; title: string }
  | { type: 'files'; title: string }
  | { type: 'progress'; title: string }
  | { type: 'history'; title: string }
  | { type: 'actions'; title: string };

export type PageConfig = {
  blocks: PageBlock[];
};

export type AutomationVersionBody = {
  inputSchema: AutomationInputSchema;
  outputSchema: Record<string, unknown>;
  steps: AutomationStepDefinition[];
  pageConfig: PageConfig;
  authorizationPolicy: AuthorizationPolicy;
};

export type EmailEffectDecision = 'allow' | 'approve' | 'reject';
