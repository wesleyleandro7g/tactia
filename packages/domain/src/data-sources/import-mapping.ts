import { CUSTOM_MAPPING_PREFIX } from '../data-catalog/types';

export { CUSTOM_MAPPING_PREFIX };

export type MappingField = { value: string; label: string };

const IGNORE: MappingField = { value: '', label: 'Ignorar coluna' };

const SHARED_IDS: MappingField[] = [
  { value: 'external_id', label: 'ID externo' },
  { value: 'name', label: 'Nome' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefone' },
  { value: 'document', label: 'Documento' },
  { value: 'status', label: 'Status' },
];

export const TARGET_ENTITIES = [
  { value: 'customer', label: 'Clientes' },
  { value: 'product', label: 'Produtos' },
  { value: 'seller', label: 'Vendedores' },
  { value: 'lead', label: 'Leads' },
  { value: 'sale', label: 'Vendas' },
  { value: 'interaction', label: 'Interações' },
  { value: 'activity', label: 'Atividades' },
  { value: 'expense', label: 'Despesas' },
  { value: 'payment', label: 'Pagamentos' },
  { value: 'inventory_level', label: 'Estoque' },
  { value: 'campaign', label: 'Campanhas' },
] as const;

export type TargetEntity = (typeof TARGET_ENTITIES)[number]['value'];

const FIELDS_BY_ENTITY: Record<string, MappingField[]> = {
  customer: [
    IGNORE,
    ...SHARED_IDS,
    { value: 'segment', label: 'Segmento' },
    { value: 'city', label: 'Cidade' },
    { value: 'state', label: 'Estado' },
    { value: 'acquisition_source', label: 'Origem de aquisição' },
  ],
  lead: [
    IGNORE,
    { value: 'external_id', label: 'ID externo' },
    { value: 'name', label: 'Nome' },
    { value: 'email', label: 'E-mail' },
    { value: 'phone', label: 'Telefone' },
    { value: 'source', label: 'Origem' },
    { value: 'status', label: 'Status' },
    { value: 'score', label: 'Score' },
    { value: 'customer_external_id', label: 'ID externo do cliente' },
    { value: 'seller_external_id', label: 'ID externo do vendedor' },
  ],
  product: [
    IGNORE,
    { value: 'external_id', label: 'ID externo' },
    { value: 'name', label: 'Nome' },
    { value: 'sku', label: 'SKU' },
    { value: 'category', label: 'Categoria' },
    { value: 'supplier', label: 'Fornecedor' },
    { value: 'price', label: 'Preço' },
    { value: 'cost', label: 'Custo' },
    { value: 'status', label: 'Status' },
  ],
  seller: [
    IGNORE,
    { value: 'external_id', label: 'ID externo' },
    { value: 'name', label: 'Nome' },
    { value: 'email', label: 'E-mail' },
    { value: 'status', label: 'Status' },
  ],
  sale: [
    IGNORE,
    { value: 'external_id', label: 'ID externo' },
    { value: 'customer_external_id', label: 'ID externo do cliente' },
    { value: 'seller_external_id', label: 'ID externo do vendedor' },
    { value: 'product_external_id', label: 'ID externo do produto' },
    { value: 'sold_at', label: 'Data da venda' },
    { value: 'total_amount', label: 'Valor total' },
    { value: 'quantity', label: 'Quantidade' },
    { value: 'unit_price', label: 'Preço unitário' },
    { value: 'discount_amount', label: 'Desconto' },
    { value: 'currency', label: 'Moeda' },
    { value: 'status', label: 'Status' },
    { value: 'payment_method', label: 'Forma de pagamento' },
    { value: 'channel', label: 'Canal' },
    { value: 'region', label: 'Região' },
  ],
  interaction: [
    IGNORE,
    { value: 'external_id', label: 'ID externo' },
    { value: 'body', label: 'Corpo da mensagem' },
    { value: 'subject', label: 'Assunto' },
    { value: 'channel', label: 'Canal' },
    { value: 'direction', label: 'Direção' },
    { value: 'occurred_at', label: 'Data da interação' },
    { value: 'customer_external_id', label: 'ID externo do cliente' },
    { value: 'customer_email', label: 'E-mail do cliente' },
    { value: 'customer_phone', label: 'Telefone do cliente' },
  ],
  activity: [
    IGNORE,
    { value: 'external_id', label: 'ID externo' },
    { value: 'type', label: 'Tipo' },
    { value: 'occurred_at', label: 'Data da atividade' },
    { value: 'customer_external_id', label: 'ID externo do cliente' },
    { value: 'lead_external_id', label: 'ID externo do lead' },
    { value: 'seller_external_id', label: 'ID externo do vendedor' },
  ],
  expense: [
    IGNORE,
    { value: 'external_id', label: 'ID externo' },
    { value: 'category', label: 'Categoria' },
    { value: 'description', label: 'Descrição' },
    { value: 'amount', label: 'Valor' },
    { value: 'occurred_at', label: 'Data' },
    { value: 'recurring', label: 'Recorrente' },
    { value: 'supplier', label: 'Fornecedor' },
  ],
  payment: [
    IGNORE,
    { value: 'external_id', label: 'ID externo' },
    { value: 'sale_external_id', label: 'ID externo da venda' },
    { value: 'amount', label: 'Valor' },
    { value: 'method', label: 'Método' },
    { value: 'due_at', label: 'Vencimento' },
    { value: 'paid_at', label: 'Pago em' },
    { value: 'status', label: 'Status' },
  ],
  inventory_level: [
    IGNORE,
    { value: 'external_id', label: 'ID externo' },
    { value: 'product_external_id', label: 'ID externo do produto' },
    { value: 'quantity', label: 'Quantidade' },
    { value: 'min_quantity', label: 'Quantidade mínima' },
    { value: 'recorded_at', label: 'Data do registro' },
  ],
  campaign: [
    IGNORE,
    { value: 'external_id', label: 'ID externo' },
    { value: 'name', label: 'Nome' },
    { value: 'source', label: 'Fonte' },
    { value: 'spend', label: 'Investimento' },
    { value: 'starts_at', label: 'Início' },
    { value: 'ends_at', label: 'Fim' },
  ],
};

const COLUMN_ALIASES: Record<string, string> = {
  id: 'external_id',
  codigo: 'external_id',
  code: 'external_id',
  nome: 'name',
  telefone: 'phone',
  celular: 'phone',
  cpf: 'document',
  cnpj: 'document',
  documento: 'document',
  data: 'sold_at',
  date: 'sold_at',
  data_venda: 'sold_at',
  valor: 'total_amount',
  amount: 'total_amount',
  total: 'total_amount',
  preco: 'price',
  preço: 'price',
  qtd: 'quantity',
  qty: 'quantity',
  quantidade: 'quantity',
  cliente: 'customer_external_id',
  customer: 'customer_external_id',
  vendedor: 'seller_external_id',
  produto: 'product_external_id',
  mensagem: 'body',
  texto: 'body',
  segmento: 'segment',
  cidade: 'city',
  estado: 'state',
  fornecedor: 'supplier',
  canal: 'channel',
  regiao: 'region',
  forma_pagamento: 'payment_method',
};

export function targetFieldsFor(entity: string, extra: MappingField[] = []): MappingField[] {
  return [...(FIELDS_BY_ENTITY[entity] ?? FIELDS_BY_ENTITY.customer ?? [IGNORE]), ...extra];
}

function normalizeColumn(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');
}

export function guessMapping(
  columns: Array<{ name: string }>,
  entity: string,
  extra: MappingField[] = [],
): Record<string, string> {
  const allowed = new Set(targetFieldsFor(entity, extra).map((field) => field.value).filter(Boolean));
  const customByBareKey = new Map(
    extra
      .filter((field) => field.value.startsWith(CUSTOM_MAPPING_PREFIX))
      .map((field) => [field.value.slice(CUSTOM_MAPPING_PREFIX.length), field.value]),
  );
  const guessed: Record<string, string> = {};

  for (const column of columns) {
    const key = normalizeColumn(column.name);
    const direct = allowed.has(key) ? key : undefined;
    const aliased = COLUMN_ALIASES[key];
    const custom = customByBareKey.get(key);
    const target = direct ?? (aliased && allowed.has(aliased) ? aliased : undefined) ?? custom;
    if (target) guessed[column.name] = target;
  }

  return guessed;
}

export function sourceNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.csv$/i, '').replace(/[_-]+/g, ' ').trim();
  return base.length > 0 ? base : 'Importação CSV';
}

export function customMappingFields(
  definitions: Array<{ fieldKey: string; label: string }>,
): MappingField[] {
  return definitions.map((definition) => ({
    value: `${CUSTOM_MAPPING_PREFIX}${definition.fieldKey}`,
    label: `${definition.label} (custom)`,
  }));
}
