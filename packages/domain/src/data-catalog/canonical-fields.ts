import {
  FLEXIBLE_ENTITY_TYPES,
  type CanonicalFieldSpec,
  type EntityTableSpec,
  type FlexibleEntityType,
} from './types';

function text(key: string, label: string, column = key, extra: Partial<CanonicalFieldSpec> = {}): CanonicalFieldSpec {
  return { key, label, type: 'text', column, filterable: true, aggregatable: false, ...extra };
}

function uuid(key: string, label: string, column = key): CanonicalFieldSpec {
  return { key, label, type: 'uuid', column, filterable: true, aggregatable: false };
}

function number(key: string, label: string, column = key, extra: Partial<CanonicalFieldSpec> = {}): CanonicalFieldSpec {
  return { key, label, type: 'number', column, filterable: true, aggregatable: true, ...extra };
}

function datetime(key: string, label: string, column = key): CanonicalFieldSpec {
  return { key, label, type: 'datetime', column, filterable: true, aggregatable: false };
}

function select(key: string, label: string, column = key): CanonicalFieldSpec {
  return { key, label, type: 'select', column, filterable: true, aggregatable: false };
}

export const ENTITY_TABLES: Record<FlexibleEntityType, EntityTableSpec> = {
  customer: {
    entityType: 'customer',
    table: 'customers',
    label: 'Clientes',
    deletedAtColumn: 'deleted_at',
    defaultOrderColumn: 'created_at',
    fields: [
      uuid('id', 'ID'),
      text('name', 'Nome'),
      text('email', 'E-mail'),
      text('phone', 'Telefone'),
      text('document', 'Documento'),
      text('segment', 'Segmento'),
      text('city', 'Cidade'),
      text('state', 'Estado'),
      text('acquisition_source', 'Origem de aquisição', 'acquisition_source'),
      select('status', 'Status'),
      datetime('created_at', 'Criado em', 'created_at'),
      datetime('updated_at', 'Atualizado em', 'updated_at'),
    ],
  },
  product: {
    entityType: 'product',
    table: 'products',
    label: 'Produtos',
    deletedAtColumn: 'deleted_at',
    defaultOrderColumn: 'created_at',
    fields: [
      uuid('id', 'ID'),
      text('name', 'Nome'),
      text('sku', 'SKU'),
      text('category', 'Categoria'),
      text('supplier', 'Fornecedor'),
      number('cost', 'Custo'),
      number('price', 'Preço'),
      select('status', 'Status'),
      datetime('created_at', 'Criado em', 'created_at'),
    ],
  },
  sale: {
    entityType: 'sale',
    table: 'sales',
    label: 'Vendas',
    defaultOrderColumn: 'sold_at',
    fields: [
      uuid('id', 'ID'),
      uuid('customer_id', 'Cliente', 'customer_id'),
      uuid('seller_id', 'Vendedor', 'seller_id'),
      number('total_amount', 'Valor total', 'total_amount'),
      number('discount_amount', 'Desconto', 'discount_amount'),
      text('currency', 'Moeda'),
      select('status', 'Status'),
      text('payment_method', 'Forma de pagamento', 'payment_method'),
      text('channel', 'Canal'),
      text('region', 'Região'),
      datetime('sold_at', 'Data da venda', 'sold_at'),
      datetime('created_at', 'Criado em', 'created_at'),
    ],
  },
  sale_item: {
    entityType: 'sale_item',
    table: 'sale_items',
    label: 'Itens de venda',
    defaultOrderColumn: 'id',
    fields: [
      uuid('id', 'ID'),
      uuid('sale_id', 'Venda', 'sale_id'),
      uuid('product_id', 'Produto', 'product_id'),
      number('quantity', 'Quantidade'),
      number('unit_price', 'Preço unitário', 'unit_price'),
      number('discount_amount', 'Desconto', 'discount_amount'),
      number('total_amount', 'Valor total', 'total_amount'),
    ],
  },
};

export function getEntitySpec(entityType: FlexibleEntityType): EntityTableSpec {
  return ENTITY_TABLES[entityType];
}

export function listEntitySpecs(entityType?: FlexibleEntityType): EntityTableSpec[] {
  if (entityType) return [ENTITY_TABLES[entityType]];
  return FLEXIBLE_ENTITY_TYPES.map((type) => ENTITY_TABLES[type]);
}
