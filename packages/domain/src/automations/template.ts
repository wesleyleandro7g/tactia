import {
  REPORT_KEYS,
  REPORTS_PORTAL_COMPONENT_KEY,
  REPORTS_PORTAL_WORKFLOW_KEY,
  REPORTS_PORTAL_WORKFLOW_VERSION,
  type AutomationVersionBody,
} from './model';

export type ReportsPortalTemplateInput = {
  connectionId: string;
  preauthorizedRecipients?: string[];
  approvalRecipients?: string[];
  revisionId?: string;
};

/** Definição inicial do piloto: exportar, validar e enviar relatórios fictícios. */
export function reportsPortalVersionBody(input: ReportsPortalTemplateInput): AutomationVersionBody {
  const connectionId = input.connectionId;
  return {
    inputSchema: {
      fields: [
        { key: 'periodStart', label: 'Início do período', type: 'date', required: true },
        { key: 'periodEnd', label: 'Fim do período', type: 'date', required: true },
        {
          key: 'reports',
          label: 'Relatórios',
          type: 'string[]',
          required: true,
          enum: [...REPORT_KEYS],
        },
        { key: 'recipient', label: 'Destinatário', type: 'email', required: true, released: true },
      ],
    },
    outputSchema: { artifacts: 'files', delivery: 'email' },
    steps: [
      {
        key: 'export',
        kind: 'browser_workflow',
        retryable: true,
        workflowKey: REPORTS_PORTAL_WORKFLOW_KEY,
        workflowVersion: REPORTS_PORTAL_WORKFLOW_VERSION,
        connectionId,
        ...(input.revisionId ? { revisionId: input.revisionId } : {}),
      },
      { key: 'validate', kind: 'validate_reports', retryable: true },
      { key: 'send', kind: 'send_email', retryable: false },
    ],
    pageConfig: {
      blocks: [
        { type: 'form', title: 'Executar' },
        { type: 'progress', title: 'Etapas' },
        { type: 'files', title: 'Arquivos gerados' },
        { type: 'table', title: 'Relatórios' },
        { type: 'metrics', title: 'Situação' },
        { type: 'history', title: 'Histórico' },
        { type: 'actions', title: 'Ações' },
      ],
    },
    authorizationPolicy: {
      connections: [connectionId],
      requireRealTransport: false,
      effects: {
        send_email: {
          preauthorizedRecipients: input.preauthorizedRecipients ?? [],
          approvalRecipients: input.approvalRecipients ?? [],
        },
      },
    },
  };
}

export const REPORTS_PORTAL_META = {
  key: 'reports-portal',
  name: 'Relatórios do portal',
  purpose: 'Gera os relatórios selecionados no portal de teste e envia os arquivos por e-mail.',
  componentKey: REPORTS_PORTAL_COMPONENT_KEY,
};

export const NOTIFY_EMAIL_META = {
  key: 'notify-email',
  name: 'Aviso por e-mail',
  purpose: 'Envia um aviso ao destinatário liberado, sem navegador.',
  componentKey: null as string | null,
};

export function notifyEmailVersionBody(input: { preauthorizedRecipients?: string[]; approvalRecipients?: string[] }): AutomationVersionBody {
  return {
    inputSchema: {
      fields: [
        { key: 'recipient', label: 'Destinatário', type: 'email', required: true, released: true },
        { key: 'subject', label: 'Assunto', type: 'string', required: true },
        { key: 'body', label: 'Mensagem', type: 'string', required: true },
      ],
    },
    outputSchema: { delivery: 'email' },
    steps: [{ key: 'send', kind: 'send_email', retryable: false }],
    pageConfig: {
      blocks: [
        { type: 'form', title: 'Enviar aviso' },
        { type: 'progress', title: 'Etapas' },
        { type: 'history', title: 'Histórico' },
        { type: 'actions', title: 'Ações' },
      ],
    },
    authorizationPolicy: {
      connections: [],
      requireRealTransport: false,
      effects: {
        send_email: {
          preauthorizedRecipients: input.preauthorizedRecipients ?? [],
          approvalRecipients: input.approvalRecipients ?? [],
        },
      },
    },
  };
}

export const AUTOMATION_TEMPLATES = {
  'reports.portal': {
    meta: REPORTS_PORTAL_META,
    body: () => reportsPortalVersionBody({ connectionId: 'demo-reports-portal' }),
  },
  'notify.email': {
    meta: NOTIFY_EMAIL_META,
    body: () => notifyEmailVersionBody({}),
  },
} as const;

export type AutomationTemplateKey = keyof typeof AUTOMATION_TEMPLATES;
