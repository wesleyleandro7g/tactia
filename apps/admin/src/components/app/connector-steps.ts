import type { SourceKind } from '@tactia/domain/data-sources/catalog';
import type { WizardStepMeta } from '@/components/app/wizard-stepper';

export type ConnectorStepId = 'identity' | 'config' | 'credentials' | 'review';

export function connectorStepsFor(kind: SourceKind): Array<WizardStepMeta & { id: ConnectorStepId }> {
  const steps: Array<WizardStepMeta & { id: ConnectorStepId }> = [
    { id: 'identity', label: 'Identidade' },
  ];

  if (kind.configFields.length > 0) {
    steps.push({ id: 'config', label: configStepLabel(kind.id) });
  }

  if (kind.credentialFields.length > 0) {
    steps.push({ id: 'credentials', label: 'Credenciais' });
  }

  steps.push({ id: 'review', label: 'Revisão' });
  return steps;
}

function configStepLabel(kindId: string): string {
  switch (kindId) {
    case 'csv':
    case 'xlsx':
      return 'Arquivo';
    case 'postgres':
    case 'database':
      return 'Conexão';
    case 'mcp':
    case 'rest':
      return 'Endpoint';
    default:
      return 'Configuração';
  }
}

/** Copy específica por conector na tela do wizard. */
export function connectorScreenCopy(kind: SourceKind): { title: string; description: string } {
  switch (kind.id) {
    case 'csv':
      return {
        title: 'Arquivo CSV',
        description: 'Envie a planilha exportada do sistema do cliente. O arquivo fica no servidor para sync.',
      };
    case 'postgres':
    case 'database':
      return {
        title: 'Banco de dados',
        description:
          'Escolha o dialeto, informe as credenciais e teste a conexão antes de mapear as tabelas.',
      };
    case 'mcp':
      return {
        title: 'Servidor MCP',
        description: 'URL HTTP do servidor MCP da empresa e, se necessário, o header Authorization.',
      };
    case 'google_sheets':
      return {
        title: 'Google Sheets',
        description: 'Registre a planilha e o token. O sync ficará bloqueado até o conector existir.',
      };
    case 'notion':
      return {
        title: 'Notion',
        description: 'ID do database e integration token. O sync ficará bloqueado até o conector existir.',
      };
    case 'trello':
      return {
        title: 'Trello',
        description: 'Autorize via OAuth 2.0, selecione vários quadros e configure o histórico.',
      };
    case 'erp':
      return {
        title: 'ERP',
        description: 'Nome do ERP e credenciais de acesso. O sync ficará bloqueado até o conector existir.',
      };
    case 'crm':
      return {
        title: 'CRM',
        description: 'Nome do CRM e API key. O sync ficará bloqueado até o conector existir.',
      };
    case 'rest':
      return {
        title: 'API REST',
        description: 'URL base e autenticação. O sync ficará bloqueado até o conector existir.',
      };
    case 'xlsx':
      return {
        title: 'Planilha Excel',
        description: 'Caminho do arquivo .xlsx. O sync ficará bloqueado até o conector existir.',
      };
    case 'custom':
      return {
        title: 'Integração customizada',
        description: 'Fonte própria ainda sem tipo no catálogo. Grave nome, config e o que for necessário.',
      };
    default:
      return {
        title: kind.label,
        description: kind.description,
      };
  }
}
