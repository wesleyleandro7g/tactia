import { describe, expect, it } from 'vitest';
import { guessMapping, sourceNameFromFile, targetFieldsFor } from './import-mapping';

describe('import-mapping', () => {
  it('expõe campos de venda, produto e vendedor', () => {
    const sale = targetFieldsFor('sale').map((field) => field.value);
    expect(sale).toContain('sold_at');
    expect(sale).toContain('total_amount');
    expect(sale).toContain('customer_external_id');

    const product = targetFieldsFor('product').map((field) => field.value);
    expect(product).toContain('sku');
    expect(product).toContain('price');

    const seller = targetFieldsFor('seller').map((field) => field.value);
    expect(seller).toContain('email');
  });

  it('adivinha colunas por nome e alias', () => {
    const sale = guessMapping([{ name: 'id' }, { name: 'valor' }, { name: 'data' }], 'sale');
    expect(sale.id).toBe('external_id');
    expect(sale.valor).toBe('total_amount');
    expect(sale.data).toBe('sold_at');

    const customer = guessMapping([{ name: 'Nome' }, { name: 'telefone' }], 'customer');
    expect(customer.Nome).toBe('name');
    expect(customer.telefone).toBe('phone');
  });

  it('deriva o nome da fonte a partir do arquivo', () => {
    expect(sourceNameFromFile('clientes_abril.csv')).toBe('clientes abril');
  });
});
