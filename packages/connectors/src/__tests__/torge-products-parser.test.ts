import { describe, expect, it } from 'vitest';
import { parseTorgeProductsCsv, TorgeParserError } from '../providers/torge/parsers/products';

const profile = {
  delimiter: ';' as const,
  encoding: 'utf-8' as const,
  columns: {
    externalId: 'ID',
    name: 'Nome',
    sku: 'Codigo',
    price: 'Preco',
    cost: 'Custo',
    quantity: 'Quantidade',
    status: 'Situacao',
  },
};

describe('parseTorgeProductsCsv', () => {
  it('preserves leading zeros, decimal precision, null and zero distinctly', () => {
    const rows = parseTorgeProductsCsv(
      Buffer.from('ID;Nome;Codigo;Preco;Custo;Quantidade;Situacao\n0007;Produto sintético;000042;1.234,5678;;0;Ativo\n'),
      profile,
    );
    expect(rows).toEqual([
      expect.objectContaining({
        external_id: '0007',
        sku: '000042',
        price: '1234.5678',
        cost: null,
        source_quantity: '0',
        status: 'active',
      }),
    ]);
  });

  it('rejects HTML login saved as CSV', () => {
    expect(() => parseTorgeProductsCsv(Buffer.from('<!doctype html><form>login</form>'), profile)).toThrowError(
      expect.objectContaining<Partial<TorgeParserError>>({ code: 'TORGE_PRODUCTS_HTML_LOGIN' }),
    );
  });

  it('rejects missing required columns and duplicate identities', () => {
    expect(() => parseTorgeProductsCsv(Buffer.from('Nome;Codigo\nA;1\n'), profile)).toThrowError(
      expect.objectContaining<Partial<TorgeParserError>>({ code: 'TORGE_PRODUCTS_SCHEMA_CHANGED' }),
    );
    expect(() => parseTorgeProductsCsv(Buffer.from('ID;Nome\n1;A\n1;B\n'), { ...profile, columns: { externalId: 'ID', name: 'Nome' } })).toThrowError(
      expect.objectContaining<Partial<TorgeParserError>>({ code: 'TORGE_PRODUCTS_DUPLICATE_ID' }),
    );
  });
});
