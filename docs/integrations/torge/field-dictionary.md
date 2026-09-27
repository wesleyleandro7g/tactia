# Dicionário de campos Torge implementados

O dicionário descreve o contrato interno do workflow/parser, não afirma nomes de colunas reais do Torge. O perfil de CSV deve ser preenchido somente após arquivo autorizado. Valores vazios, nulos e zero são preservados conforme abaixo.

## Produtos — parser v1 / mapping v1

| Campo interno | Destino | Tipo/regra | Evidência/estado |
| --- | --- | --- | --- |
| `external_id` | `Product.externalId` | texto obrigatório; zeros à esquerda preservados; recebe prefixo conta/filial antes do raw | ID global da origem ainda precisa ser comprovado |
| `name` | `Product.name` | texto obrigatório | nome visualmente observado |
| `sku` | `Product.sku` | texto opcional; zeros à esquerda preservados | código visualmente observado |
| `price` | `Product.price` | decimal string opcional, pt-BR normalizado sem arredondar antes do Decimal(18,4) | preços visualmente observados; coluna real pendente |
| `cost` | `Product.cost` | decimal string opcional | campo/coluna real pendente |
| `status` | `Product.status` | `active`, `inactive` ou nulo | filtros Ativos/Inativos/Todos observados |
| `source_barcode` | custom `barcode` | texto opcional; nunca usado sozinho como identidade | barras visualmente observado |
| `source_quantity` | custom `source_quantity` | decimal string; `0` distinto de nulo | quantidade visualmente observada |
| `source_unit` | custom `unit` | texto opcional | unidade visualmente observada |
| `source_group` | custom `group` | texto opcional | grupo visualmente observado |

O output estruturado deve ser `{ complete: true, sourceTotal: number, rows: [...] }`. `sourceTotal` deve ser semanticamente equivalente aos filtros explícitos e igual ao número de identidades únicas. Sem isso o pipeline não publica.

Campos fiscais observados ainda não entram no mapping: os nomes, tipos e semântica não foram capturados de forma autorizada. Adicione-os como custom fields somente após evidência, versão nova e teste de precisão/nulidade.