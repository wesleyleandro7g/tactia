import { describe, expect, it } from 'vitest';
import {
  defaultSqlPort,
  getSourceKind,
  groupSelectableSourceKinds,
  isSelectableSourceKind,
  listSelectableSourceKinds,
  sourceKindDisplayLabel,
  sourceKindHasConnector,
  sqlDialectFromSource,
} from './catalog';

describe('data source catalog', () => {
  it('exposes selectable kinds and hides system sources', () => {
    const ids = listSelectableSourceKinds().map((kind) => kind.id);
    expect(ids).toContain('csv');
    expect(ids).toContain('database');
    expect(ids).not.toContain('postgres');
    expect(ids).toContain('notion');
    expect(ids).toContain('trello');
    expect(ids).toContain('web_portal');
    expect(ids).toContain('erp');
    expect(ids).toContain('crm');
    expect(ids).toContain('custom');
    expect(ids).not.toContain('image');
    expect(isSelectableSourceKind('image')).toBe(false);
    expect(isSelectableSourceKind('salesforce')).toBe(false);
    expect(isSelectableSourceKind('postgres')).toBe(false);
    expect(isSelectableSourceKind('database')).toBe(true);
  });

  it('marks implemented connectors', () => {
    expect(sourceKindHasConnector('csv')).toBe(true);
    expect(sourceKindHasConnector('database')).toBe(true);
    expect(sourceKindHasConnector('postgres')).toBe(true);
    expect(sourceKindHasConnector('mcp')).toBe(true);
    expect(sourceKindHasConnector('web_portal')).toBe(true);
    expect(sourceKindHasConnector('notion')).toBe(false);
    expect(getSourceKind('google_sheets')?.label).toBe('Google Sheets');
    expect(getSourceKind('postgres')?.label).toBe('PostgreSQL');
    expect(getSourceKind('database')?.label).toBe('Banco de dados');
  });

  it('resolves SQL dialect and display labels', () => {
    expect(sqlDialectFromSource('postgres')).toBe('postgres');
    expect(sqlDialectFromSource('mysql')).toBe('mysql');
    expect(sqlDialectFromSource('database', { dialect: 'mysql' })).toBe('mysql');
    expect(sqlDialectFromSource('database', { dialect: 'postgres' })).toBe('postgres');
    expect(sqlDialectFromSource('database', {})).toBe('postgres');
    expect(sqlDialectFromSource('csv')).toBeNull();
    expect(defaultSqlPort('postgres')).toBe(5432);
    expect(defaultSqlPort('mysql')).toBe(3306);
    expect(sourceKindDisplayLabel('postgres')).toBe('PostgreSQL');
    expect(sourceKindDisplayLabel('database', { dialect: 'mysql' })).toBe('MySQL');
    expect(sourceKindDisplayLabel('csv')).toBe('Arquivo CSV');
  });

  it('groups selectable kinds once per group', () => {
    const groups = groupSelectableSourceKinds();
    const ids = groups.map((group) => group.group);
    expect(new Set(ids).size).toBe(ids.length);
    expect(groups.find((group) => group.group === 'databases')?.kinds.map((kind) => kind.id)).toEqual([
      'database',
    ]);
    expect(groups.find((group) => group.group === 'integrations')?.kinds.map((kind) => kind.id)).toEqual([
      'rest',
      'mcp',
      'custom',
    ]);
    expect(groups.find((group) => group.group === 'business_systems')?.kinds.map((kind) => kind.id)).toEqual([
      'torge',
      'web_portal',
      'erp',
      'crm',
    ]);
  });
});
