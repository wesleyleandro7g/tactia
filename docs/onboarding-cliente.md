# Onboarding de um cliente real

Guia do operador para colocar uma empresa dentro da Tactia, do zero até o primeiro
insight. A conexão das fontes de dados é feita **só no Tactia Ops**
(`/tenants/:id/data-sources`). O app do cliente (`/onboarding`) registra a empresa
quando o próprio usuário cria a conta — não importa CSV nem Postgres. Tempo esperado:
**20 a 40 minutos**, sendo a maior parte a preparação dos dados do cliente.

> Se o ambiente ainda não estiver no ar, comece por [deploy-producao.md](./deploy-producao.md).
> Se algo falhar no meio do caminho, vá para o [runbook](./runbook.md).

---

## 0. Antes de começar

Tenha em mãos:

| Item | Por quê |
|---|---|
| Nome da empresa | Vira o `Tenant` |
| E-mail do owner | Primeiro usuário, com papel `owner` |
| A fonte de dados | CSV exportado ou credenciais de um PostgreSQL de leitura |
| `LLM_API_KEY` configurada no ambiente | Sem ela o `/chat` fica indisponível (o resto funciona) |
| Seu acesso ao Tactia Ops (`apps/admin`) | Provisionar a empresa, usuários e diagnosticar sync |

Checagem rápida do ambiente:

```bash
curl -s https://SEU-HOST/api/v1/health
# {"data":{"status":"ok","database":"up"}, ...}
```

### Se a fonte for CSV

No Tactia Ops, abra a empresa → **Nova fonte** → **Arquivo CSV**. O upload
grava o CSV em `UPLOAD_DIR` (default `/tmp/tactia-uploads` no host, `/data/uploads`
no compose de produção) e o conector lê o caminho gerado.

Um arquivo por entidade. Cabeçalhos aceitos pelo mapeamento (o nome da coluna de
origem pode ser qualquer um — você escolhe o destino no mapeamento):

| Entidade | Campos de destino |
|---|---|
| `customer` | `external_id`*, `name`*, `email`, `phone`, `document`, `segment`, `city`, `state`, `acquisition_source` |
| `product` | `external_id`*, `name`*, `sku`, `category`, `supplier`, `price`, `cost` |
| `seller` | `external_id`*, `name`*, `email` |
| `lead` | `external_id`*, `name`*, `email`, `phone`, `source`, `status`, `score`, `customer_external_id`, `seller_external_id` |
| `sale` | `external_id`*, `customer_external_id`*, `sold_at`*, `total_amount`, `seller_external_id`, `product_external_id`, `quantity`, `unit_price`, `discount_amount`, `currency`, `status`, `payment_method`, `channel`, `region` |
| `interaction` | `external_id`*, `body`*, `occurred_at`*, `channel`, `direction`, `subject`, `customer_external_id`, `customer_email`, `customer_phone` |
| `activity` | `external_id`*, `type`*, `occurred_at`*, `lead_external_id`, `customer_external_id`, `seller_external_id` |
| `expense` | `external_id`*, `category`*, `amount`*, `occurred_at`*, `description`, `supplier`, `recurring` |
| `payment` | `external_id`*, `sale_external_id`*, `amount`*, `due_at`*, `paid_at`, `method`, `status` |
| `inventory_level` | `external_id`*, `product_external_id`*, `quantity`*, `recorded_at`*, `min_quantity` |
| `campaign` | `external_id`*, `name`*, `source`*, `spend`*, `starts_at`*, `ends_at` |

\* obrigatórios. Sem `external_id` a linha é descartada (não há como fazer upsert
idempotente). Uma venda sem cliente resolvível também é descartada — e o motivo
aparece no relatório de qualidade.

`total_amount` pode ser omitido se houver `unit_price` (ou preço do produto) e
`quantity`. `status` aceita `pending`, `confirmed`, `cancelled`, `refunded`;
qualquer outro valor entra como `confirmed`. **Receita só considera `confirmed`.**

### Se a fonte for PostgreSQL

Peça ao cliente um usuário **somente leitura**:

```sql
CREATE USER tactia_ro WITH PASSWORD '...';
GRANT CONNECT ON DATABASE erp TO tactia_ro;
GRANT USAGE ON SCHEMA public TO tactia_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO tactia_ro;
```

A senha é cifrada com AES-256-GCM antes de ser gravada e só é descriptografada no
momento de conectar. Nenhuma rota devolve a senha.

---

## 1. Criar a conta do owner

Abra o Tactia Ops (`https://ops.SEU-HOST` ou `http://localhost:3001`) e use
**Nova empresa**. Informe o nome da empresa e o owner (nome, e-mail, senha
provisória). Isso cria o `Tenant` e o usuário `owner` no app dos clientes.

Grava `TENANT_CREATED`, `USER_CREATED` e `MEMBERSHIP_CREATED` no audit log
com `actorType: 'operator'`.

O cliente entra em `https://SEU-HOST/login` com o e-mail/senha do owner — não
no backoffice.

Também é possível o próprio cliente criar a empresa em `/signup`.

## 2. Convidar o resto do time

`/api/v1/users` (owner/admin):

```bash
curl -X POST https://SEU-HOST/api/v1/users -b cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"name":"Analista","email":"analista@cliente.com","password":"provisoria123","role":"member"}'
```

Papéis: `owner` > `admin` > `member` > `viewer`. Só `owner`/`admin` aprovam ações.
Não há e-mail de convite na V0.1 — combine a senha provisória por outro canal.

## 3. Trazer os dados (Ops)

No Tactia Ops, abra a ficha da empresa → **Nova fonte**. Escolha o tipo
(CSV, PostgreSQL, Notion, Trello, ERP, CRM, REST, MCP, custom…). Tipos sem
conector ficam **registrados** (a equipe sabe de onde vêm os dados); teste e
sync só funcionam hoje para CSV, PostgreSQL e MCP.

Para CSV: envie o arquivo e diga de que entidade ele é no mapeamento
(clientes, produtos, vendedores, vendas…). Para PostgreSQL: host, porta, banco,
usuário e senha de leitura.

Importante para CSV: **um arquivo por entidade**. Referências entre entidades
são resolvidas primeiro dentro da mesma fonte e, se não encontradas, no tenant
inteiro — então as vendas encontram os clientes mesmo estando em outra fonte.

Ordem canônica (o normalizer já aplica):

```text
customer → product → seller → lead → sale → payment → activity →
expense → inventory_level → campaign → interaction
```

Depois da importação, cadastre metas em `/settings/goals` e fatos do negócio em
`/settings/facts` (ex.: “o vendedor X saiu em março”). Sem metas o chat ainda
funciona; com metas ele passa a falar de ritmo e gap.

## 4. Conferir a leitura

Na ficha da fonte, **Testar conexão** e **Descobrir**. Para CSV, o teste confirma
que o arquivo é legível e lista as colunas. Para Postgres, abre a conexão
(`SELECT 1`) e descobre as tabelas. Erro aqui é de arquivo, infraestrutura ou
credencial — a mensagem aparece na tela.

## 5. Mapear colunas

Na mesma tela da fonte, ligue cada coluna de origem ao campo canônico usando a
tabela do passo 0.

Ordem de importação obrigatória quando as vendas referenciam outras entidades:

```text
clientes → produtos → vendedores → vendas
```

## 6. Prévia

Depois de descobrir, confira as colunas mapeadas. Datas devem ser reconhecíveis por
`new Date()` — `2026-08-25` e `2026-08-25T13:00:00Z` funcionam; `25/08/2026` não.

## 7. Importar

**Disparar sync** na ficha da fonte (ou da empresa) executa o ciclo completo (spec §37):

```text
fonte → RawRecord (original preservado) → normalização → upsert canônico
      → relatório de qualidade → Import → pipeline de insights
```

Rodar de novo é seguro: o upsert usa `(tenant, fonte, external_id)`, então nada
duplica (spec §38).

## 8. Validar os dados

A tela de resultado no Ops mostra sync jobs e imports:

```text
✓ 1.842 clientes na base
✓ 8.421 vendas na base
✓ 42 vendedores encontrados
✓ R$ 1.284.000 em vendas analisadas
```

Confira `Registros lidos / criados / atualizados / falhas`. **Qualquer coisa
diferente de 0 em falhas** merece uma olhada no relatório de qualidade:

```bash
curl -s -b cookies.txt "https://SEU-HOST/api/v1/imports" | jq
```

Motivos mais comuns: `missing_external_id`, `sale_customer_not_found`,
`sale_invalid_date`, `sale_without_amount`, `duplicated_external_id`.

## 9. Métricas

`/dashboard` já mostra receita, vendas, clientes e ticket médio do mês corrente,
com variação contra o período anterior. Se os números vierem zerados com dados
importados, cheque o período (`?from=&to=`) e o `status` das vendas — canceladas e
estornadas nunca entram na receita.

## 10. Primeiros insights

O pipeline determinístico roda **automaticamente depois de cada importação**.
Para rodar de novo sob demanda, use **Rodar análise** no dashboard.

Espere ver, quando os dados justificarem: queda ou crescimento de receita,
produto em alta/baixa, leads e clientes inativos, vendedor fora da média,
meta atrasada, gargalo de funil, despesas, estoque e CAC. Cada insight traz
impacto em R$, as principais causas e uma recomendação. Use o polegar no card
para calibrar o limiar da regra.

---

## Fechamento com o cliente

Um roteiro de 15 minutos que costuma funcionar:

1. `/dashboard` — os quatro números e a variação.
2. Um insight com a evidência aberta: "isso não é opinião, é a métrica X no período Y".
3. `/chat` — "Quanto vendemos este mês?" e "Quem mais vendeu?", mostrando a fonte citada.
4. Peça uma ação no chat ("crie uma tarefa para ligar para o cliente X") e mostre
   que ela **fica pendente de aprovação** — a Tactia nunca age sozinha.
5. `/approvals` — aprovar e ver a execução registrada.

## Depois do onboarding

- Reimporte periodicamente (Tactia Ops → ficha da empresa ou da fonte → **Disparar sync**).
- Acompanhe a ficha da empresa no Ops: sync jobs, contadores, erros e insights.
- Limites por padrão: 6 syncs/min, 20 mensagens de chat/min por tenant,
  60 req/min por API key MCP.

## Agentes externos

Se o cliente quiser o Claude Desktop (ou outro agente interno) falando com os
dados da empresa, o owner/admin emite uma API key em `/settings/api-keys` e
aponta o cliente para `POST /api/v1/mcp` com `Authorization: Bearer tactia_live_...`.

São as **mesmas tools** do chat. Números vêm no JSON (`data` + `sources`). A prosa
que o cliente MCP escrever **não** passa pelo guardrail de números do chat. Uma
`propose_action` entra na fila de `/approvals` — a Tactia não executa sozinha.
Não use `CRON_SECRET` nesse header. Detalhe operacional no [runbook](./runbook.md#131-agentes-externos-mcp).
