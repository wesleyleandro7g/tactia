# Catálogo de módulos Torge

Atualizado em 21/09/2026. Status possíveis: `implementado_sem_validacao_real`, `pendente`, `indisponivel`, `nao_aplicavel`, `validado`. Apenas `validado` pode ser apresentado como sincronizado em produção.

A conta inspecionada comprovou visualmente catálogo de produtos, paginação e opções de CSV em produtos, inventário, faturamento e contas a receber. Nenhum CSV foi capturado; colunas, cobertura, IDs, filial e permissões completas continuam pendentes. O total observado de 1.174 produtos ativos não é uma expectativa permanente.

| Família | Conjunto / caminho a confirmar | Permissão | Granularidade | Aquisição preferida | Identidade requerida | Filtros/escopo | Dependências | Status | Limitações/evidência |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cadastros | Produtos / catálogo | leitura de produtos | produto | CSV comprovado; fallback tabela paginada + detalhe | ID estável da origem; nunca nome/barra | ativos, inativos, todos; empresa/filial | grupo, fornecedor quando disponíveis | implementado_sem_validacao_real | parser exige perfil real de colunas; CSV/download e isolamento não validados |
| Cadastros | Clientes | a confirmar | cliente | exportação/tabela/detalhe | ID estável da origem | ativos/inativos; empresa/filial | vendedores quando houver | pendente | tela, campos e identidade não inspecionados |
| Cadastros | Fornecedores | a confirmar | fornecedor | exportação/tabela/detalhe | ID estável da origem | ativos/inativos; empresa/filial | nenhuma conhecida | pendente | não inspecionado |
| Cadastros | Transportadoras | a confirmar | transportadora | tabela/detalhe | ID estável da origem | ativos/inativos; empresa/filial | nenhuma conhecida | pendente | não inspecionado |
| Cadastros | Vendedores | a confirmar | vendedor | exportação/tabela/detalhe | ID estável da origem | ativos/inativos; empresa/filial | nenhuma conhecida | pendente | não inspecionado |
| Cadastros | Serviços | a confirmar | serviço | exportação/tabela/detalhe | ID estável da origem | ativos/inativos; empresa/filial | tributações quando aplicável | pendente | não inspecionado |
| Estoque | Saldos | a confirmar | produto × filial/local | inventário CSV; fallback tabela | ID produto + filial/local | incluir zero e negativo | produtos | pendente | opção de zero/negativo observada, arquivo não capturado |
| Estoque | Inventário | a confirmar | item/posição de inventário | CSV | ID produto + filial/local + instante | zero, negativo, data, filial | produtos | pendente | botão Gerar CSV observado; schema desconhecido |
| Estoque | Movimentações | a confirmar | movimento | exportação/tabela/detalhe | ID movimento ou chave estável composta comprovada | período, tipo, filial | produtos, documentos | pendente | não inspecionado |
| Estoque | Grades | a confirmar | produto × variação | tabela/detalhe | ID produto + ID variação | empresa/filial | produtos | pendente | disponibilidade condicional |
| Estoque | Coleções | a confirmar | coleção/produto | tabela/detalhe | ID coleção + ID produto | situação | produtos | pendente | disponibilidade condicional |
| Estoque | Composições | a confirmar | composição × componente | tabela/detalhe | ID composição + ID componente | situação | produtos | pendente | não inspecionado |
| Estoque | Lotes/seriais | a confirmar | lote/serial × item | tabela/detalhe | ID estável/lote/serial + produto + filial | situação/período | produtos, movimentos | pendente | somente se recurso acessível |
| Entradas | Pedidos de compra | a confirmar | documento | tabela/detalhe | ID estável do pedido | período, situação, filial | fornecedores | pendente | não inspecionado |
| Entradas | Itens de pedido de compra | a confirmar | item de documento | ID item; fallback substituição atômica dos filhos | detalhe estruturado | documento | pedido, produtos | pendente | identidade ainda não comprovada |
| Entradas | Notas de entrada | a confirmar | documento fiscal | tabela/detalhe/XML quando pertinente | chave/ID estável comprovado | período, situação, filial | fornecedores | pendente | não inspecionado |
| Entradas | Itens de nota de entrada | a confirmar | item de documento | detalhe/XML | ID item; fallback conjunto completo | documento | nota, produtos | pendente | identidade ainda não comprovada |
| Entradas | Montagem de composição | a confirmar | montagem/itens | tabela/detalhe | ID montagem + itens | período, filial | composições, produtos | pendente | não inspecionado |
| Saídas | Orçamentos | a confirmar | documento | tabela/detalhe | ID estável do orçamento | período, situação, filial | clientes, vendedores, produtos | pendente | `Importar` em pedido referencia orçamento interno; não é upload externo |
| Saídas | Pedidos de venda | a confirmar | documento | tabela/detalhe | ID estável do pedido | período, situação, filial | clientes, vendedores, produtos | pendente | erro com data `6/1/2026` deve ser tratado como falha, não vazio |
| Saídas | Itens de pedido | a confirmar | item de documento | detalhe | ID item; fallback conjunto completo | documento | pedido, produtos | pendente | identidade ainda não comprovada |
| Saídas | Pré-vendas | a confirmar | documento | tabela/detalhe | ID estável | período, situação, filial | clientes, produtos | pendente | não inspecionado |
| Saídas | Ordens de serviço | a confirmar | ordem/itens | tabela/detalhe | ID ordem + ID item | período, situação, filial | clientes, serviços/produtos | pendente | não inspecionado |
| Saídas | Faturamento | a confirmar | documento/item conforme CSV | CSV; fallback tabela/detalhe | ID/chave fiscal estável | período, tipos, canceladas, filial | clientes, produtos | pendente | CSV e filtros observados; schema/cobertura desconhecidos |
| Saídas | Notas de serviço | a confirmar | documento/item | tabela/detalhe/XML se disponível | ID/chave estável | período, situação, filial | clientes, serviços | pendente | não inspecionado |
| Saídas | Cupons | a confirmar | cupom/item | tabela/detalhe/XML | chave/ID estável | período, canceladas, filial | clientes quando identificado, produtos | pendente | vínculos com pedidos/notas precisam evitar dupla contagem |
| Financeiro | Contas a receber | a confirmar | título/parcela | CSV; fallback tabela/detalhe | ID título/parcela estável | abertos independente da emissão; período de liquidação | cliente e documento de origem | pendente | Gerar CSV observado; schema desconhecido |
| Financeiro | Contas recebidas | a confirmar | liquidação/parcela | CSV/tabela/detalhe | ID liquidação/parcela | período de liquidação, filial | título | pendente | não inspecionado |
| Financeiro | Contas a pagar | a confirmar | título/parcela | exportação/tabela/detalhe | ID título/parcela | abertos independente da emissão | fornecedor/documento | pendente | não inspecionado |
| Financeiro | Contas pagas | a confirmar | liquidação/parcela | exportação/tabela/detalhe | ID liquidação/parcela | período de liquidação | título | pendente | não inspecionado |
| Financeiro | Caixa | a confirmar | movimento | tabela/exportação | ID movimento | período, caixa, filial | documentos quando vinculados | pendente | não inspecionado |
| Financeiro | Movimentações bancárias | a confirmar | movimento | tabela/exportação | ID movimento | período, conta, filial | títulos quando vinculados | pendente | não inspecionado |
| Fiscal/auxiliar | Download XMLs | a confirmar | XML/documento | download de arquivo | chave do documento | período, tipo, filial | documento fiscal | pendente | menu observado; formato e cobertura não validados |
| Fiscal/auxiliar | Documentos/manifestações | a confirmar | documento/evento | XML/tabela | chave + evento | período, situação, filial | fornecedores/clientes | pendente | somente leitura; nunca manifestar/transmitir |
| Fiscal/auxiliar | MDF-e | a confirmar | documento | tabela/XML | chave/ID estável | período, situação, filial | transportadora/documentos | pendente | coleta não pode acionar emissão/encerramento |
| Fiscal/auxiliar | Agenda | a confirmar | evento | tabela/detalhe | ID evento | período/usuário | entidades vinculadas | pendente | não inspecionado |
| Fiscal/auxiliar | Tributações | a confirmar | regra/cadastro | tabela/detalhe | ID estável da regra | empresa/filial | produtos/serviços | pendente | excluir segredos e configurações de segurança |
| Fiscal/auxiliar | Relação CFOP | a confirmar | CFOP/relação | tabela | código + escopo comprovado | empresa/filial | nenhuma conhecida | pendente | não inspecionado |
| Fiscal/auxiliar | Boletos | a confirmar | boleto/título | tabela/detalhe/arquivo somente leitura | ID boleto/título | situação/período | contas a receber | pendente | não emitir, cancelar ou registrar boleto |
| Condicional | Integrações adicionais habilitadas | permissão específica | a confirmar | somente leitura e conforme recurso | a confirmar | empresa/filial | módulo contratado | pendente | não ativar, contratar ou ampliar permissões |
| Analítico | Curva ABC | a confirmar | agregado derivado | preferir cálculo Tactia sobre base | dimensões/período | período/filial | produtos e vendas | nao_aplicavel | não importar como nova venda; só conjunto separado se base não cobrir |
| Analítico | Lucratividade | a confirmar | agregado derivado | preferir cálculo Tactia sobre base | dimensões/período | período/filial | vendas, custo e despesas | nao_aplicavel | não duplicar transações de base |

## Política inicial

- Cadastros e estoque: carga completa; produtos incluem inativos e estoque inclui zero/negativo quando os controles forem validados.
- Transações: períodos retomáveis, janela recente diária e reconciliação histórica rotativa.
- Financeiro: títulos abertos independentemente da emissão e liquidações recentes.
- Nenhuma ausência inativa dados enquanto completude e identidade não estiverem comprovadas.
- Datas são fornecidas ao workflow em ISO e o fluxo validado deve preencher o controle na localidade observada; mensagem de erro de data invalida a coleta.
- Módulos pendentes não são habilitáveis nem exibidos como sincronizados.