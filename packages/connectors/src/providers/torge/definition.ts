export type TorgeModuleStatus = 'implemented' | 'pending' | 'unavailable' | 'not_applicable';

export type TorgeModuleDefinition = {
  id: string;
  name: string;
  family: string;
  status: TorgeModuleStatus;
  mappingVersion: string;
  parserVersion?: string;
  workflowKey?: string;
  workflowVersion?: string;
  targetEntity?: string;
  acquisition: 'full' | 'periodic' | 'open_and_recent' | 'derived';
  dependencies: string[];
  limitations: string[];
};

const pending = (id: string, name: string, family: string, acquisition: TorgeModuleDefinition['acquisition'] = 'periodic'): TorgeModuleDefinition => ({
  id,
  name,
  family,
  status: 'pending',
  mappingVersion: 'unvalidated',
  acquisition,
  dependencies: [],
  limitations: ['Fluxo, identidade e schema ainda não validados em conta autorizada.'],
});

export const TORGE_MODULES: readonly TorgeModuleDefinition[] = [
  {
    id: 'products', name: 'Produtos', family: 'Cadastros', status: 'implemented',
    mappingVersion: '1', parserVersion: '1', workflowKey: 'torge.products', workflowVersion: '1',
    targetEntity: 'product', acquisition: 'full', dependencies: [],
    limitations: ['Requer perfil de colunas/identidade obtido de arquivo real autorizado.', 'Download CSV real ainda não validado.'],
  },
  pending('customers', 'Clientes', 'Cadastros', 'full'),
  pending('suppliers', 'Fornecedores', 'Cadastros', 'full'),
  pending('carriers', 'Transportadoras', 'Cadastros', 'full'),
  pending('sellers', 'Vendedores', 'Cadastros', 'full'),
  pending('services', 'Serviços', 'Cadastros', 'full'),
  pending('inventory_balances', 'Saldos de estoque', 'Estoque', 'full'),
  pending('inventory_movements', 'Movimentações de estoque', 'Estoque'),
  pending('variants', 'Grades', 'Estoque', 'full'),
  pending('collections', 'Coleções', 'Estoque', 'full'),
  pending('compositions', 'Composições', 'Estoque', 'full'),
  pending('lots_serials', 'Lotes e seriais', 'Estoque'),
  pending('purchase_orders', 'Pedidos de compra', 'Entradas'),
  pending('incoming_invoices', 'Notas de entrada', 'Entradas'),
  pending('composition_assembly', 'Montagem de composição', 'Entradas'),
  pending('quotes', 'Orçamentos', 'Saídas'),
  pending('sales_orders', 'Pedidos de venda', 'Saídas'),
  pending('pre_sales', 'Pré-vendas', 'Saídas'),
  pending('service_orders', 'Ordens de serviço', 'Saídas'),
  pending('billing', 'Faturamento', 'Saídas'),
  pending('service_invoices', 'Notas de serviço', 'Saídas'),
  pending('receipts', 'Cupons', 'Saídas'),
  pending('receivables', 'Contas a receber e recebidas', 'Financeiro', 'open_and_recent'),
  pending('payables', 'Contas a pagar e pagas', 'Financeiro', 'open_and_recent'),
  pending('cash', 'Caixa', 'Financeiro'),
  pending('bank_movements', 'Movimentações bancárias', 'Financeiro'),
  pending('xml_documents', 'XMLs e documentos fiscais', 'Fiscal e auxiliares'),
  pending('mdfe', 'MDF-e', 'Fiscal e auxiliares'),
  pending('agenda', 'Agenda', 'Fiscal e auxiliares'),
  pending('tax_rules', 'Tributações e CFOP', 'Fiscal e auxiliares', 'full'),
  pending('bank_slips', 'Boletos', 'Fiscal e auxiliares', 'open_and_recent'),
];

export const TORGE_PROVIDER = {
  id: 'torge',
  name: 'Torge',
  accessMechanisms: ['browser'] as const,
  modules: TORGE_MODULES,
};

export function getTorgeModule(id: string): TorgeModuleDefinition | undefined {
  return TORGE_MODULES.find((module) => module.id === id);
}

export function assertTorgeModulesEnableable(ids: string[]): TorgeModuleDefinition[] {
  const unique = [...new Set(ids)];
  return unique.map((id) => {
    const module = getTorgeModule(id);
    if (!module) throw new Error(`Módulo Torge desconhecido: ${id}`);
    if (module.status !== 'implemented') throw new Error(`Módulo Torge ainda não habilitável: ${id}`);
    return module;
  });
}
