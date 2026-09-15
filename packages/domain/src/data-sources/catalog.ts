export type CatalogFieldType = 'string' | 'number' | 'boolean' | 'url' | 'secret' | 'file';

export type CatalogField = {
  key: string;
  label: string;
  type: CatalogFieldType;
  required?: boolean;
  hint?: string;
  placeholder?: string;
};

export type SourceConnectorKind = 'csv' | 'postgres' | 'mcp' | 'none';

export type SourceKindGroupId =
  | 'files'
  | 'databases'
  | 'spreadsheets'
  | 'work_management'
  | 'business_systems'
  | 'integrations'
  | 'system';

export type SourceKind = {
  id: string;
  label: string;
  description: string;
  group: SourceKindGroupId;
  groupLabel: string;
  connector: SourceConnectorKind;
  selectable: boolean;
  configFields: CatalogField[];
  credentialFields: CatalogField[];
};

const FILES = 'Arquivos';
const DATABASES = 'Bancos de dados';
const SPREADSHEETS = 'Planilhas e documentos';
const WORK = 'Gestão de trabalho';
const BUSINESS = 'Sistemas de negócio';
const INTEGRATIONS = 'Integrações';
const SYSTEM = 'Sistema';

export const SOURCE_KINDS: readonly SourceKind[] = [
  {
    id: 'csv',
    label: 'Arquivo CSV',
    description: 'Planilha exportada do sistema do cliente.',
    group: 'files',
    groupLabel: FILES,
    connector: 'csv',
    selectable: true,
    configFields: [
      {
        key: 'filePath',
        label: 'Arquivo CSV',
        type: 'file',
        required: true,
        hint: 'O arquivo fica no servidor e o conector lê o caminho gerado.',
      },
    ],
    credentialFields: [],
  },
  {
    id: 'xlsx',
    label: 'Planilha Excel',
    description: 'Arquivo .xlsx. O conector ainda não está disponível.',
    group: 'files',
    groupLabel: FILES,
    connector: 'none',
    selectable: true,
    configFields: [{ key: 'filePath', label: 'Caminho do arquivo', type: 'string' }],
    credentialFields: [],
  },
  {
    id: 'postgres',
    label: 'PostgreSQL',
    description: 'Banco de leitura da empresa.',
    group: 'databases',
    groupLabel: DATABASES,
    connector: 'postgres',
    selectable: true,
    configFields: [
      { key: 'host', label: 'Host', type: 'string', required: true, placeholder: 'db.cliente.com' },
      { key: 'port', label: 'Porta', type: 'number', placeholder: '5432' },
      { key: 'database', label: 'Banco', type: 'string', required: true },
      { key: 'schema', label: 'Schema', type: 'string', placeholder: 'public' },
      { key: 'ssl', label: 'SSL', type: 'boolean' },
    ],
    credentialFields: [
      { key: 'username', label: 'Usuário', type: 'string', required: true },
      { key: 'password', label: 'Senha', type: 'secret', required: true },
    ],
  },
  {
    id: 'google_sheets',
    label: 'Google Sheets',
    description: 'Planilhas do Google. O conector ainda não está disponível.',
    group: 'spreadsheets',
    groupLabel: SPREADSHEETS,
    connector: 'none',
    selectable: true,
    configFields: [
      { key: 'spreadsheetId', label: 'ID da planilha', type: 'string', required: true },
      { key: 'range', label: 'Intervalo', type: 'string', placeholder: 'Sheet1!A1:Z' },
    ],
    credentialFields: [{ key: 'accessToken', label: 'Access token', type: 'secret' }],
  },
  {
    id: 'notion',
    label: 'Notion',
    description: 'Database do Notion. O conector ainda não está disponível.',
    group: 'spreadsheets',
    groupLabel: SPREADSHEETS,
    connector: 'none',
    selectable: true,
    configFields: [{ key: 'databaseId', label: 'ID do database', type: 'string', required: true }],
    credentialFields: [{ key: 'apiKey', label: 'Integration token', type: 'secret', required: true }],
  },
  {
    id: 'trello',
    label: 'Trello',
    description: 'Quadros do Trello. O conector ainda não está disponível.',
    group: 'work_management',
    groupLabel: WORK,
    connector: 'none',
    selectable: true,
    configFields: [{ key: 'boardId', label: 'ID do quadro', type: 'string', required: true }],
    credentialFields: [
      { key: 'apiKey', label: 'API key', type: 'secret', required: true },
      { key: 'token', label: 'Token', type: 'secret', required: true },
    ],
  },
  {
    id: 'erp',
    label: 'ERP',
    description: 'Integração própria com ERP. O conector ainda não está disponível.',
    group: 'business_systems',
    groupLabel: BUSINESS,
    connector: 'none',
    selectable: true,
    configFields: [
      { key: 'providerName', label: 'Nome do ERP', type: 'string', required: true, placeholder: 'SAP, TOTVS, Bling…' },
      { key: 'baseUrl', label: 'URL base', type: 'url' },
    ],
    credentialFields: [
      { key: 'username', label: 'Usuário', type: 'string' },
      { key: 'password', label: 'Senha', type: 'secret' },
      { key: 'apiKey', label: 'API key', type: 'secret' },
    ],
  },
  {
    id: 'crm',
    label: 'CRM',
    description: 'Integração própria com CRM. O conector ainda não está disponível.',
    group: 'business_systems',
    groupLabel: BUSINESS,
    connector: 'none',
    selectable: true,
    configFields: [
      { key: 'providerName', label: 'Nome do CRM', type: 'string', required: true, placeholder: 'HubSpot, Pipedrive…' },
      { key: 'baseUrl', label: 'URL base', type: 'url' },
    ],
    credentialFields: [{ key: 'apiKey', label: 'API key', type: 'secret' }],
  },
  {
    id: 'rest',
    label: 'API REST',
    description: 'Endpoint HTTP próprio. O conector ainda não está disponível.',
    group: 'integrations',
    groupLabel: INTEGRATIONS,
    connector: 'none',
    selectable: true,
    configFields: [{ key: 'baseUrl', label: 'URL base', type: 'url', required: true }],
    credentialFields: [{ key: 'apiKey', label: 'API key', type: 'secret' }],
  },
  {
    id: 'mcp',
    label: 'MCP',
    description: 'Servidor MCP HTTP da empresa.',
    group: 'integrations',
    groupLabel: INTEGRATIONS,
    connector: 'mcp',
    selectable: true,
    configFields: [{ key: 'url', label: 'URL do servidor', type: 'url', required: true }],
    credentialFields: [{ key: 'authorization', label: 'Authorization', type: 'secret' }],
  },
  {
    id: 'custom',
    label: 'Integração customizada',
    description: 'Fonte própria ainda sem tipo no catálogo. Grave nome, config e credenciais.',
    group: 'integrations',
    groupLabel: INTEGRATIONS,
    connector: 'none',
    selectable: true,
    configFields: [{ key: 'providerName', label: 'Nome da aplicação', type: 'string', required: true }],
    credentialFields: [],
  },
  {
    id: 'document',
    label: 'Documentos',
    description: 'Fonte de sistema para ingestão de documentos.',
    group: 'system',
    groupLabel: SYSTEM,
    connector: 'none',
    selectable: false,
    configFields: [],
    credentialFields: [],
  },
  {
    id: 'image',
    label: 'Imagens',
    description: 'Fonte de sistema para visão.',
    group: 'system',
    groupLabel: SYSTEM,
    connector: 'none',
    selectable: false,
    configFields: [],
    credentialFields: [],
  },
  {
    id: 'audio',
    label: 'Áudio',
    description: 'Fonte de sistema para transcrição.',
    group: 'system',
    groupLabel: SYSTEM,
    connector: 'none',
    selectable: false,
    configFields: [],
    credentialFields: [],
  },
];

const BY_ID = new Map(SOURCE_KINDS.map((kind) => [kind.id, kind]));

export function getSourceKind(id: string): SourceKind | undefined {
  return BY_ID.get(id);
}

export function isKnownSourceKind(id: string): boolean {
  return BY_ID.has(id);
}

export function isSelectableSourceKind(id: string): boolean {
  return BY_ID.get(id)?.selectable === true;
}

export function sourceKindHasConnector(id: string): boolean {
  const kind = BY_ID.get(id);
  return Boolean(kind && kind.connector !== 'none');
}

export function listSelectableSourceKinds(): SourceKind[] {
  return SOURCE_KINDS.filter((kind) => kind.selectable);
}

export function groupSelectableSourceKinds(): Array<{ group: SourceKindGroupId; groupLabel: string; kinds: SourceKind[] }> {
  const groups: Array<{ group: SourceKindGroupId; groupLabel: string; kinds: SourceKind[] }> = [];
  const index = new Map<SourceKindGroupId, number>();
  for (const kind of listSelectableSourceKinds()) {
    const existing = index.get(kind.group);
    if (existing !== undefined) {
      groups[existing]!.kinds.push(kind);
      continue;
    }
    index.set(kind.group, groups.length);
    groups.push({ group: kind.group, groupLabel: kind.groupLabel, kinds: [kind] });
  }
  return groups;
}
