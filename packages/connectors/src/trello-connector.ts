import type { RawRecordRepository } from '@tactia/database';
import { computeChecksum } from './checksum';
import { sanitizeTrelloPayload } from './trello-webhook';
import { applyTransform } from './transforms';
import { TrelloApiError, TrelloClient, type TrelloAuth } from './trello-client';
import { TrelloOAuthError } from './trello-oauth';
import type {
  Connector,
  ConnectionTestResult,
  DiscoveryColumn,
  DiscoveryResult,
  FetchOptions,
  FieldMapping,
  RawRow,
  SyncContext,
  SyncResult,
} from './types';

export const TRELLO_RESOURCES = [
  'boards',
  'lists',
  'cards',
  'members',
  'labels',
  'checklists',
  'check_items',
  'comments',
  'actions',
  'custom_fields',
] as const;
export type TrelloResource = (typeof TRELLO_RESOURCES)[number];

export type TrelloConnectorConfig = {
  boardIds: string[];
  historyDays?: 30 | 90 | 180 | null;
  auth: TrelloAuth;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
};

const RESOURCE_COLUMNS: Record<TrelloResource, string[]> = {
  boards: ['id', 'name', 'closed', 'url', 'idOrganization', 'dateLastActivity'],
  lists: ['id', 'name', 'closed', 'pos', 'idBoard', 'board_id', 'board_name'],
  cards: ['id', 'name', 'desc', 'closed', 'due', 'dueComplete', 'start', 'dateLastActivity', 'idBoard', 'idList', 'idMembers', 'idLabels', 'url', 'board_id', 'board_name'],
  members: ['id', 'username', 'fullName', 'initials', 'avatarUrl', 'board_id', 'board_name'],
  labels: ['id', 'name', 'color', 'idBoard', 'board_id', 'board_name'],
  checklists: ['id', 'name', 'idBoard', 'idCard', 'pos', 'board_id', 'board_name'],
  check_items: ['id', 'name', 'state', 'due', 'idMember', 'idChecklist', 'idCard', 'board_id', 'board_name'],
  comments: ['id', 'type', 'date', 'idMemberCreator', 'data.text', 'data.card.id', 'data.card.name', 'board_id', 'board_name'],
  actions: ['id', 'type', 'date', 'idMemberCreator', 'data.card.id', 'data.list.id', 'data.listBefore.id', 'data.listAfter.id', 'board_id', 'board_name'],
  custom_fields: ['id', 'name', 'type', 'fieldGroup', 'idModel', 'board_id', 'board_name'],
};

function isResource(value: string): value is TrelloResource {
  return (TRELLO_RESOURCES as readonly string[]).includes(value);
}

function flattenObject(value: Record<string, unknown>, prefix = '', output: RawRow = {}): RawRow {
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      flattenObject(nested as Record<string, unknown>, path, output);
    } else {
      output[path] = nested;
    }
  }
  return output;
}

function rowFor(value: Record<string, unknown>, board: Record<string, unknown>): RawRow {
  return {
    ...flattenObject(value),
    board_id: board['id'],
    board_name: board['name'],
    _raw: value,
  };
}

function customFieldValue(
  item: Record<string, unknown>,
  definition: Record<string, unknown>,
): unknown {
  const value = item['value'];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return record['text'] ?? record['number'] ?? record['date'] ?? record['checked'] ?? value;
  }
  const idValue = item['idValue'];
  const options = Array.isArray(definition['options'])
    ? definition['options'] as Array<Record<string, unknown>>
    : [];
  const option = options.find((candidate) => candidate['id'] === idValue);
  const optionValue = option?.['value'];
  return optionValue && typeof optionValue === 'object'
    ? (optionValue as Record<string, unknown>)['text'] ?? idValue
    : idValue;
}

function withCustomFields(
  cards: Array<Record<string, unknown>>,
  definitions: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const byId = new Map(definitions
    .filter((definition) => typeof definition['id'] === 'string')
    .map((definition) => [definition['id'] as string, definition]));
  return cards.map((card) => {
    const output = { ...card };
    const items = Array.isArray(card['customFieldItems'])
      ? card['customFieldItems'] as Array<Record<string, unknown>>
      : [];
    for (const item of items) {
      const definition = byId.get(String(item['idCustomField'] ?? ''));
      if (!definition) continue;
      const stable = String(definition['fieldGroup'] ?? definition['id']);
      output[`custom.${stable}`] = customFieldValue(item, definition);
    }
    return output;
  });
}

function dateSince(days: number | null | undefined): Date | undefined {
  if (days == null) return undefined;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export class TrelloConnector implements Connector {
  private readonly client: TrelloClient;

  constructor(
    private readonly config: TrelloConnectorConfig,
    private readonly rawRecords?: RawRecordRepository,
  ) {
    this.client = new TrelloClient({
      auth: config.auth,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const member = await this.client.me();
      return {
        success: true,
        message: 'Conexão com o Trello bem-sucedida',
        details: { memberId: member['id'], username: member['username'] },
      };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async listBoards() {
    return this.client.listBoards();
  }

  async discover(): Promise<DiscoveryResult> {
    const resources = await Promise.all(TRELLO_RESOURCES.map(async (name) => {
      const columns: DiscoveryColumn[] = RESOURCE_COLUMNS[name].map((column) => ({
        name: column,
        type: column.startsWith('id') || column.endsWith('_id') ? 'string' : 'unknown',
        nullable: true,
      }));
      let sampleRows: RawRow[] = [];
      if (this.config.boardIds.length > 0) {
        sampleRows = await this.fetch(name, { limit: 3 }).catch(() => []);
        const known = new Set(columns.map((column) => column.name));
        for (const key of sampleRows.flatMap((row) => Object.keys(row))) {
          if (!known.has(key) && key !== '_raw') {
            known.add(key);
            columns.push({ name: key, type: 'unknown', nullable: true });
          }
        }
      }
      return { name, columns, ...(sampleRows.length ? { sampleRows } : {}) };
    }));
    return { resources };
  }

  async fetch(resource: string, options: FetchOptions = {}): Promise<RawRow[]> {
    if (!isResource(resource)) throw new Error(`Recurso Trello desconhecido: ${resource}`);
    const all = await this.fetchAll(resource, options.since);
    const offset = Math.max(0, options.offset ?? 0);
    return all.slice(offset, offset + Math.max(1, options.limit ?? 1000));
  }

  normalize(row: RawRow, fieldMappings: FieldMapping[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const mapping of fieldMappings) {
      result[mapping.target] = applyTransform(row[mapping.source], mapping.transform);
    }
    return result;
  }

  async sync(context: SyncContext): Promise<SyncResult> {
    if (!this.rawRecords) throw new Error('RawRecordRepository required for sync');
    const counters = { read: 0, created: 0, updated: 0, failed: 0 };
    const requested = new Set<TrelloResource>(TRELLO_RESOURCES);
    const rowsByResource = new Map<TrelloResource, RawRow[]>();
    const since = context.mode === 'incremental' ? context.since : dateSince(this.config.historyDays);

    for (const resource of requested) {
      try {
        const rows = await this.fetchAll(resource, resource === 'actions' || resource === 'comments' ? since : undefined);
        rowsByResource.set(resource, rows);
        for (const row of rows) {
          counters.read++;
          await this.persist(context, `trello:${resource}`, row, String(row['id'] ?? counters.read), counters);
        }
      } catch (error) {
        if (
          (error instanceof TrelloApiError && error.status === 401) ||
          (error instanceof TrelloOAuthError && [400, 401].includes(error.status))
        ) throw error;
        counters.failed++;
      }
      context.onProgress?.(counters);
    }

    for (const mapping of context.mappings) {
      if (!isResource(mapping.sourceEntity)) continue;
      const rows = rowsByResource.get(mapping.sourceEntity) ?? [];
      for (const row of rows) {
        try {
          const externalId = `${mapping.sourceEntity}:${String(row['id'] ?? counters.read)}`;
          await this.persist(context, mapping.targetEntity, row, externalId, counters, false);
        } catch {
          counters.failed++;
        }
      }
    }

    return {
      recordsRead: counters.read,
      recordsCreated: counters.created,
      recordsUpdated: counters.updated,
      recordsFailed: counters.failed,
    };
  }

  private async persist(
    context: SyncContext,
    entityType: string,
    row: RawRow,
    externalId: string,
    counters: { created: number; updated: number },
    count = true,
  ) {
    const { created } = await this.rawRecords!.upsertByKey({
      tenantId: context.tenantId,
      dataSourceId: context.dataSourceId,
      syncJobId: context.syncJobId,
      externalId,
      entityType,
      payload: row,
      checksum: computeChecksum(row),
    });
    if (count) {
      if (created) counters.created++;
      else counters.updated++;
    }
  }

  private async fetchAll(resource: TrelloResource, since?: Date): Promise<RawRow[]> {
    const rows: RawRow[] = [];
    for (const boardId of this.config.boardIds) {
      const board = await this.client.get<Record<string, unknown>>(`boards/${encodeURIComponent(boardId)}`, {
        fields: 'all',
      });
      let values: Array<Record<string, unknown>> = [];
      switch (resource) {
        case 'boards': values = [board]; break;
        case 'lists': values = await this.client.get(`boards/${encodeURIComponent(boardId)}/lists`, { filter: 'all', fields: 'all' }); break;
        case 'cards': {
          const [cards, definitions] = await Promise.all([
            this.client.get<Array<Record<string, unknown>>>(`boards/${encodeURIComponent(boardId)}/cards/all`, { fields: 'all', customFieldItems: true }),
            this.client.get<Array<Record<string, unknown>>>(`boards/${encodeURIComponent(boardId)}/customFields`),
          ]);
          values = withCustomFields(cards, definitions);
          break;
        }
        case 'members': values = await this.client.get(`boards/${encodeURIComponent(boardId)}/members`, { fields: 'id,username,fullName,initials,avatarUrl' }); break;
        case 'labels': values = await this.client.get(`boards/${encodeURIComponent(boardId)}/labels`, { fields: 'all', limit: 1000 }); break;
        case 'checklists': values = await this.client.get(`boards/${encodeURIComponent(boardId)}/checklists`, { checkItems: 'all', checkItem_fields: 'all', fields: 'all' }); break;
        case 'check_items': {
          const checklists = await this.client.get<Array<Record<string, unknown>>>(`boards/${encodeURIComponent(boardId)}/checklists`, { checkItems: 'all', checkItem_fields: 'all', fields: 'all' });
          values = checklists.flatMap((checklist) => {
            const items = Array.isArray(checklist['checkItems']) ? checklist['checkItems'] as Array<Record<string, unknown>> : [];
            return items.map((item) => ({ ...item, idChecklist: checklist['id'], idCard: checklist['idCard'] }));
          });
          break;
        }
        case 'custom_fields': values = await this.client.get(`boards/${encodeURIComponent(boardId)}/customFields`); break;
        case 'actions': values = await this.client.listBoardActions(boardId, { ...(since ? { since } : {}) }); break;
        case 'comments': {
          const actions = await this.client.listBoardActions(boardId, { ...(since ? { since } : {}) });
          values = actions.filter((action) => action['type'] === 'commentCard');
          break;
        }
      }
      rows.push(...values.map((value) => rowFor(
        (resource === 'actions' || resource === 'comments'
          ? sanitizeTrelloPayload(value)
          : value) as Record<string, unknown>,
        board,
      )));
    }
    return rows;
  }
}
