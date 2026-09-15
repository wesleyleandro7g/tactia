import { describe, expect, it } from 'vitest';
import {
  getSourceKind,
  groupSelectableSourceKinds,
  isSelectableSourceKind,
  listSelectableSourceKinds,
  sourceKindHasConnector,
} from './catalog';

describe('data source catalog', () => {
  it('exposes selectable kinds and hides system sources', () => {
    const ids = listSelectableSourceKinds().map((kind) => kind.id);
    expect(ids).toContain('csv');
    expect(ids).toContain('postgres');
    expect(ids).toContain('notion');
    expect(ids).toContain('trello');
    expect(ids).toContain('erp');
    expect(ids).toContain('crm');
    expect(ids).toContain('custom');
    expect(ids).not.toContain('image');
    expect(isSelectableSourceKind('image')).toBe(false);
    expect(isSelectableSourceKind('salesforce')).toBe(false);
  });

  it('marks implemented connectors', () => {
    expect(sourceKindHasConnector('csv')).toBe(true);
    expect(sourceKindHasConnector('postgres')).toBe(true);
    expect(sourceKindHasConnector('mcp')).toBe(true);
    expect(sourceKindHasConnector('notion')).toBe(false);
    expect(getSourceKind('google_sheets')?.label).toBe('Google Sheets');
  });

  it('groups selectable kinds once per group', () => {
    const groups = groupSelectableSourceKinds();
    const ids = groups.map((group) => group.group);
    expect(new Set(ids).size).toBe(ids.length);
    expect(groups.find((group) => group.group === 'integrations')?.kinds.map((kind) => kind.id)).toEqual([
      'rest',
      'mcp',
      'custom',
    ]);
  });
});
