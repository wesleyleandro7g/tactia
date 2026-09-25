import { parse } from 'csv-parse/sync';

export const TORGE_PRODUCTS_PARSER_VERSION = '1';

export type TorgeProductColumnProfile = {
  delimiter: ',' | ';' | '\t';
  encoding: 'utf-8';
  columns: {
    externalId: string;
    name: string;
    sku?: string;
    barcode?: string;
    quantity?: string;
    price?: string;
    cost?: string;
    unit?: string;
    group?: string;
    status?: string;
  };
};

export type TorgeProductRow = {
  external_id: string;
  name: string;
  sku: string | null;
  price: string | null;
  cost: string | null;
  status: 'active' | 'inactive' | null;
  source_quantity: string | null;
  source_barcode: string | null;
  source_unit: string | null;
  source_group: string | null;
};

export class TorgeParserError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TorgeParserError';
  }
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const valueText = String(value).trim();
  return valueText === '' ? null : valueText;
}

function decimal(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const compact = raw.replace(/\s/g, '');
  const normalized = compact.includes(',')
    ? compact.replace(/\./g, '').replace(',', '.')
    : compact;
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new TorgeParserError('TORGE_PRODUCTS_INVALID_DECIMAL', 'Produto contém decimal inválido.');
  }
  return normalized;
}

function status(value: unknown): 'active' | 'inactive' | null {
  const raw = text(value)?.toLocaleLowerCase('pt-BR');
  if (!raw) return null;
  if (raw === 'ativo' || raw === 'active') return 'active';
  if (raw === 'inativo' || raw === 'inactive') return 'inactive';
  throw new TorgeParserError('TORGE_PRODUCTS_INVALID_STATUS', 'Produto contém situação desconhecida.');
}

function assertProfile(profile: TorgeProductColumnProfile) {
  if (!profile.columns.externalId || !profile.columns.name) {
    throw new TorgeParserError('TORGE_PRODUCTS_PROFILE_INVALID', 'Perfil de colunas sem identidade ou nome.');
  }
}

function htmlLike(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 1024).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<form') && head.includes('login');
}

export function parseTorgeProductsCsv(buffer: Buffer, profile: TorgeProductColumnProfile): TorgeProductRow[] {
  assertProfile(profile);
  if (buffer.length === 0) throw new TorgeParserError('TORGE_PRODUCTS_FILE_EMPTY', 'Arquivo de produtos vazio.');
  if (htmlLike(buffer)) throw new TorgeParserError('TORGE_PRODUCTS_HTML_LOGIN', 'O download retornou uma página de login.');
  if (buffer.includes(0)) throw new TorgeParserError('TORGE_PRODUCTS_ENCODING_INVALID', 'Codificação do arquivo não é UTF-8 textual.');

  let records: Record<string, unknown>[];
  try {
    records = parse(buffer, {
      bom: true,
      columns: true,
      delimiter: profile.delimiter,
      skip_empty_lines: true,
      relax_column_count: false,
      trim: false,
    }) as Record<string, unknown>[];
  } catch {
    throw new TorgeParserError('TORGE_PRODUCTS_CSV_INVALID', 'CSV de produtos inválido.');
  }

  const headers = records.length > 0 ? Object.keys(records[0]!) : [];
  const required = [profile.columns.externalId, profile.columns.name];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new TorgeParserError('TORGE_PRODUCTS_SCHEMA_CHANGED', `CSV sem colunas obrigatórias: ${missing.join(', ')}.`);
  }

  const ids = new Set<string>();
  return records.map((record) => {
    const externalId = text(record[profile.columns.externalId]);
    const name = text(record[profile.columns.name]);
    if (!externalId) throw new TorgeParserError('TORGE_PRODUCTS_ID_MISSING', 'Produto sem identidade estável.');
    if (!name) throw new TorgeParserError('TORGE_PRODUCTS_NAME_MISSING', 'Produto sem nome.');
    if (ids.has(externalId)) throw new TorgeParserError('TORGE_PRODUCTS_DUPLICATE_ID', 'Arquivo contém identidade de produto duplicada.');
    ids.add(externalId);
    const optional = (key: keyof Omit<TorgeProductColumnProfile['columns'], 'externalId' | 'name'>) => {
      const header = profile.columns[key];
      return header ? record[header] : null;
    };
    return {
      external_id: externalId,
      name,
      sku: text(optional('sku')),
      price: decimal(optional('price')),
      cost: decimal(optional('cost')),
      status: status(optional('status')),
      source_quantity: decimal(optional('quantity')),
      source_barcode: text(optional('barcode')),
      source_unit: text(optional('unit')),
      source_group: text(optional('group')),
    };
  });
}

export function validateStructuredTorgeProducts(value: unknown): TorgeProductRow[] {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const rows = Array.isArray(value) ? value : Array.isArray(root?.['rows']) ? root['rows'] : null;
  if (!rows) throw new TorgeParserError('TORGE_PRODUCTS_OUTPUT_INVALID', 'Fluxo não retornou uma lista de produtos.');
  const seen = new Set<string>();
  return rows.map((item) => {
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
    const externalId = text(row?.['external_id']);
    const name = text(row?.['name']);
    if (!externalId || !name) throw new TorgeParserError('TORGE_PRODUCTS_OUTPUT_INVALID', 'Produto extraído sem identidade ou nome.');
    if (seen.has(externalId)) throw new TorgeParserError('TORGE_PRODUCTS_DUPLICATE_ID', 'Coleta contém identidade de produto duplicada.');
    seen.add(externalId);
    return {
      external_id: externalId,
      name,
      sku: text(row?.['sku']),
      price: decimal(row?.['price']),
      cost: decimal(row?.['cost']),
      status: status(row?.['status']),
      source_quantity: decimal(row?.['source_quantity']),
      source_barcode: text(row?.['source_barcode']),
      source_unit: text(row?.['source_unit']),
      source_group: text(row?.['source_group']),
    };
  });
}
