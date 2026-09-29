const RESOURCE_KEY = /^[a-zA-Z0-9_.-]+$/;
const MAX_PAGES = 50;
const MAX_ROWS = 10_000;

export type WebPortalPagination = {
  nextSelector: string;
  maxPages: number;
};

export type WebPortalResource = {
  key: string;
  startUrl: string;
  itemSelector: string;
  idField: string;
  fields: Record<string, string>;
  pagination?: WebPortalPagination;
  allowEmpty: boolean;
};

export type WebPortalLogin = {
  url: string;
  usernameField: string;
  passwordField: string;
};

export type WebPortalConfig = {
  allowedHosts: string[];
  resources: WebPortalResource[];
  login?: WebPortalLogin;
  adaptive: boolean;
  allowEmpty: boolean;
};

export type WebPortalCredentials = {
  username?: string;
  password?: string;
  cookie?: string;
  authorization?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

function parseHosts(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const hosts = [...new Set(parts.map((item) => normalizeHost(String(item))).filter(Boolean))];
  if (hosts.length === 0) throw new Error('Informe ao menos um host autorizado.');
  return hosts;
}

function parseUrl(value: string, label: string, allowedHosts: string[]): string {
  const raw = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} inválida.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${label} precisa usar HTTP ou HTTPS.`);
  }
  const host = normalizeHost(parsed.hostname);
  const port = parsed.port;
  const allowed = allowedHosts.some((entry) => {
    if (entry.includes(':')) return `${host}:${port || (parsed.protocol === 'https:' ? '443' : '80')}` === entry;
    return entry === host;
  });
  if (!allowed) throw new Error(`${label} não pertence aos hosts autorizados.`);
  return parsed.toString();
}

function parseFields(value: unknown): Record<string, string> {
  const row = asRecord(value);
  if (!row) throw new Error('Cada recurso precisa de um objeto fields com seletores.');
  const fields: Record<string, string> = {};
  for (const [key, selector] of Object.entries(row)) {
    const name = key.trim();
    const expression = typeof selector === 'string' ? selector.trim() : '';
    if (!RESOURCE_KEY.test(name) || !expression) {
      throw new Error('Campo de extração inválido.');
    }
    fields[name] = expression;
  }
  if (Object.keys(fields).length === 0) throw new Error('Cada recurso precisa de ao menos um campo.');
  return fields;
}

function parsePagination(value: unknown): WebPortalPagination | undefined {
  const row = asRecord(value);
  if (!row) return undefined;
  const nextSelector = String(row['nextSelector'] ?? '').trim();
  if (!nextSelector) throw new Error('Paginação sem nextSelector.');
  const maxPages = Number(row['maxPages'] ?? 20);
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error('maxPages inválido.');
  return { nextSelector, maxPages: Math.min(maxPages, MAX_PAGES) };
}

function parseBool(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
}

function parseResources(value: unknown, allowedHosts: string[], allowEmpty: boolean): WebPortalResource[] {
  let items = value;
  if (typeof value === 'string') {
    try {
      items = JSON.parse(value) as unknown;
    } catch {
      throw new Error('Recursos precisam ser um JSON válido.');
    }
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Informe ao menos um recurso de extração.');
  }
  const resources: WebPortalResource[] = [];
  const keys = new Set<string>();
  for (const item of items) {
    const row = asRecord(item);
    if (!row) throw new Error('Recurso de extração inválido.');
    const key = String(row['key'] ?? '').trim();
    if (!RESOURCE_KEY.test(key)) throw new Error('Chave de recurso inválida.');
    if (keys.has(key)) throw new Error(`Recurso duplicado: ${key}.`);
    keys.add(key);
    const fields = parseFields(row['fields']);
    const idField = String(row['idField'] ?? '').trim();
    if (!fields[idField]) throw new Error(`idField '${idField}' precisa existir em fields.`);
    const pagination = parsePagination(row['pagination']);
    resources.push({
      key,
      startUrl: parseUrl(String(row['startUrl'] ?? ''), `URL de ${key}`, allowedHosts),
      itemSelector: String(row['itemSelector'] ?? '').trim(),
      idField,
      fields,
      allowEmpty: parseBool(row['allowEmpty'], allowEmpty),
      ...(pagination ? { pagination } : {}),
    });
    if (!resources[resources.length - 1]!.itemSelector) {
      throw new Error(`Recurso ${key} sem itemSelector.`);
    }
  }
  return resources;
}

function parseLogin(row: Record<string, unknown>, allowedHosts: string[]): WebPortalLogin | undefined {
  const nested = asRecord(row['login']);
  const url = String(nested?.['url'] ?? row['loginUrl'] ?? '').trim();
  const usernameField = String(nested?.['usernameField'] ?? row['loginUsernameField'] ?? '').trim();
  const passwordField = String(nested?.['passwordField'] ?? row['loginPasswordField'] ?? '').trim();
  if (!url && !usernameField && !passwordField) return undefined;
  if (!url || !usernameField || !passwordField) {
    throw new Error('Login exige URL e nomes dos campos de usuário e senha.');
  }
  return {
    url: parseUrl(url, 'URL de login', allowedHosts),
    usernameField,
    passwordField,
  };
}

export function parseWebPortalConfig(value: unknown): WebPortalConfig {
  const row = asRecord(value);
  if (!row) throw new Error('Configuração do portal web inválida.');
  const allowedHosts = parseHosts(row['allowedHosts']);
  const login = parseLogin(row, allowedHosts);
  const allowEmpty = parseBool(row['allowEmpty'], false);
  return {
    allowedHosts,
    resources: parseResources(row['resources'], allowedHosts, allowEmpty),
    ...(login ? { login } : {}),
    adaptive: row['adaptive'] === false || row['adaptive'] === 'false' ? false : true,
    allowEmpty,
  };
}

export function parseWebPortalCredentials(value: unknown): WebPortalCredentials {
  const row = asRecord(value) ?? {};
  const pick = (key: string) => {
    const raw = row[key];
    return typeof raw === 'string' && raw.trim() ? raw : undefined;
  };
  return {
    username: pick('username'),
    password: pick('password'),
    cookie: pick('cookie'),
    authorization: pick('authorization'),
  };
}

export { MAX_PAGES, MAX_ROWS };
