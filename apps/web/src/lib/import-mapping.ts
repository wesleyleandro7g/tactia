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
] as const;

const FIELDS_BY_ENTITY: Record<string, MappingField[]> = {
  customer: [IGNORE, ...SHARED_IDS],
  lead: [
    IGNORE,
    { value: 'external_id', label: 'ID externo' },
    { value: 'name', label: 'Nome' },
    { value: 'email', label: 'E-mail' },
    { value: 'phone', label: 'Telefone' },
    { value: 'source', label: 'Origem' },
    { value: 'status', label: 'Status' },
    { value: 'score', label: 'Score' },
  ],
  product: [
    IGNORE,
    { value: 'external_id', label: 'ID externo' },
    { value: 'name', label: 'Nome' },
    { value: 'sku', label: 'SKU' },
    { value: 'category', label: 'Categoria' },
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
};

export function targetFieldsFor(entity: string): MappingField[] {
  return FIELDS_BY_ENTITY[entity] ?? FIELDS_BY_ENTITY.customer ?? [IGNORE];
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
): Record<string, string> {
  const allowed = new Set(targetFieldsFor(entity).map((field) => field.value).filter(Boolean));
  const guessed: Record<string, string> = {};

  for (const column of columns) {
    const key = normalizeColumn(column.name);
    const direct = allowed.has(key) ? key : undefined;
    const aliased = COLUMN_ALIASES[key];
    const target = direct ?? (aliased && allowed.has(aliased) ? aliased : undefined);
    if (target) guessed[column.name] = target;
  }

  return guessed;
}

export function sourceNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.csv$/i, '').replace(/[_-]+/g, ' ').trim();
  return base.length > 0 ? base : 'Importação CSV';
}
