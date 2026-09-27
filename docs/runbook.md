# Runbook

Diagnóstico e operação da Tactia em produção. Para subir o ambiente, veja
[deploy-producao.md](./deploy-producao.md). Para colocar um cliente novo, veja
[onboarding-cliente.md](./onboarding-cliente.md).

---

## 1. Primeiros comandos

```bash
# Está vivo? (sem autenticação, sem dado de tenant)
curl -s https://SEU-HOST/api/v1/health
# {"data":{"status":"ok","database":"up"},"meta":{"requestId":"..."}}

# Logs estruturados
docker compose -f docker/docker-compose.prod.yml logs -f web

# Um request específico (todo response traz o header x-request-id)
docker compose -f docker/docker-compose.prod.yml logs web | grep '"request_id":"<ID>"'
```

`health` responde 503 quando o banco não responde — é o sinal do healthcheck do
container e do load balancer.

## 2. Como ler os logs

Toda operação relevante emite uma linha JSON com os campos da spec §47:

```json
{"level":30,"request_id":"...","tenant_id":"...","user_id":"...","operation":"sync",
 "data_source_id":"...","sync_job_id":"...","records":1842,"records_created":1800,
 "records_updated":42,"records_failed":0,"duration_ms":3821,"status":"completed"}
```

| `operation` | Quando |
|---|---|
| `GET/POST /api/v1/...` | Toda requisição de API (status + duração) |
| `sync` | Importação concluída ou falha, com contadores |
| `chat` | Turno de chat completo (`mode: sync\|stream`, provider, model, tool_calls) |
| `tool:<nome>` | Cada tool executada pela IA |
| `action:<tipo>` | Execução de ação |
| `intelligence_pipeline_start/complete` | Pipeline de regras |
| `health` | Só quando falha |

Níveis: `info` (30) para o normal, `warn` (40) para 429/rate limit e falha de
tool, `error` (50) para 5xx e falha de sync/execução.

Filtros úteis:

```bash
L='docker compose -f docker/docker-compose.prod.yml logs web'
$L | grep '"status":5'                          # tudo que falhou no servidor
$L | grep '"operation":"sync"' | grep failed    # importações quebradas
$L | grep RATE_LIMITED                          # quem está batendo no limite
$L | grep '"tenant_id":"<TENANT>"'              # tudo de um cliente
$L | grep '"duration_ms":[0-9]\{4,\}'           # requisições acima de 1s
```

Nunca há stack trace na resposta HTTP: o cliente recebe `{ error: { code, message } }`
com um dos códigos da spec §48 (mais `RATE_LIMITED`). O detalhe técnico fica só no log.

## 3. Sync falhou

**Onde olhar:** Tactia Ops → ficha da empresa → tabela **Sync jobs** (status,
contadores, erro) ou, no app do cliente:

```bash
curl -s -b cookies.txt "https://SEU-HOST/api/v1/sync-jobs?pageSize=10" | jq \
  '.data.items[] | {id, status, recordsRead, recordsCreated, recordsFailed, error}'
```

O campo `error` vem no formato `CÓDIGO: mensagem`:

| Erro | Causa provável | O que fazer |
|---|---|---|
| `VALIDATION_ERROR: A fonte de dados não tem nenhum mapeamento ativo` | Fonte criada sem mapping | Criar o mapping em Tactia Ops → fonte → **Mapeamento** |
| `SYNC_ERROR: ENOENT ... .csv` | Caminho do CSV não existe **dentro do container** | Reenvie o arquivo em **Nova fonte** (CSV) ou confira `UPLOAD_DIR` |
| `SYNC_ERROR: EACCES` | Arquivo sem permissão de leitura para o usuário do container (uid 1001) | `chmod 644` no arquivo |
| `CONNECTOR_ERROR` / `P1001` | Postgres do cliente inacessível (firewall, host, porta) | Testar a conexão na ficha da fonte no Ops |
| `SYNC_ERROR: password authentication failed` | Credencial trocada no lado do cliente | Recriar a credential no Ops e apontar a fonte para o novo `credentialId` |
| `SYNC_ERROR: relation "x" does not exist` | Mapping aponta para tabela/coluna que não existe mais | Rodar **Descobrir** de novo e corrigir o mapping |
| `INTERNAL_ERROR: ENCRYPTION_KEY ...` | Chave ausente ou com tamanho errado | Ver §7 |

**Reexecutar** (seguro, idempotente):

```bash
# no Tactia Ops (grava audit log com actorType=operator)
curl -X POST https://OPS-HOST/api/v1/tenants/<TENANT>/sync -b cookies-ops.txt \
  -H 'Content-Type: application/json' \
  -d '{"dataSourceId":"<FONTE>"}'
```

Ou na ficha da empresa no Ops → **Disparar sync**.

## 4. Importou, mas os dados não apareceram

Sintoma clássico: o sync termina `completed`, mas o dashboard fica vazio.
Olhe os contadores **e** o relatório de qualidade.

```bash
curl -s -b cookies.txt "https://SEU-HOST/api/v1/imports?pageSize=20" | jq \
  '.data.items[] | {entityType, totalRecords, processedRecords, failedRecords, status}'
```

`processedRecords: 0` com `totalRecords > 0` significa que **nada foi normalizado**.
Os motivos ficam no `DataQualityReport` (campo `errors`):

| Motivo | Significado | Correção |
|---|---|---|
| `missing_external_id` | Linha sem `external_id` mapeado | Mapear a coluna de identificador da origem |
| `customer_without_name` / `product_without_name` | Campo obrigatório vazio | Corrigir a origem ou o mapping |
| `sale_without_customer` | Venda sem `customer_external_id` | Mapear a coluna do cliente |
| `sale_customer_not_found` | Cliente referenciado não existe | Importar os clientes **antes** das vendas |
| `sale_invalid_date` | `sold_at` não é uma data reconhecível | Usar ISO (`2026-08-25`) |
| `sale_without_amount` | Sem `total_amount` e sem preço/quantidade | Mapear o valor |
| `duplicated_external_id` | O mesmo `external_id` duas vezes no arquivo | Deduplicar na origem |
| `sale_negative_amount` | Valor negativo (devolução?) | Tratar como `refunded` na origem |

Corrija a origem ou o mapping e rode o sync de novo — o upsert é idempotente por
`(tenant, fonte, external_id)`, então nada duplica.

**Receita zerada com vendas na base:** confira `status` (só `confirmed` conta) e
o período do dashboard (`?from=&to=`).

## 5. Reprocessar um import

```bash
curl -X POST https://OPS-HOST/api/v1/tenants/<TENANT>/reprocess-import -b cookies-ops.txt \
  -H 'Content-Type: application/json' \
  -d '{"importId":"<IMPORT>"}'
```

Reexecuta o sync da fonte que originou o import. Os `RawRecord` originais são
preservados; só o resultado canônico é reescrito.

## 6. Chat indisponível ou estranho

| Sintoma | Causa | Ação |
|---|---|---|
| Banner "Chat indisponível" | Sem `LLM_API_KEY` | Configurar a chave e reiniciar o web |
| `AI_ERROR` (502) | Provider fora, chave inválida, cota estourada | `grep '"operation":"chat"' \| grep AI_ERROR` mostra a mensagem do provider |
| Resposta genérica "não consigo confirmar esses números" | Guardrail `unsourced_numbers`: o modelo citou número sem evidência | Esperado. Se recorrente, revisar se as tools estão devolvendo dados (`grep '"operation":"tool:'`) |
| `RATE_LIMITED` (429) | Mais de 20 mensagens/min no tenant | Esperado; ajustar em `apps/web/src/lib/rate-limit.ts` se necessário |
| Chat responde, mas sem números | Tenant sem dados no período | Importar dados / conferir o período |

O chat nunca executa nada: uma proposta de ação sempre cai em `/approvals`.

## 7. Segredos e chaves

| Variável | Efeito se faltar/estiver errada |
|---|---|
| `ENCRYPTION_KEY` (64 hex) | Credenciais não podem ser criadas nem lidas → sync Postgres falha |
| `BETTER_AUTH_SECRET` (≥32 chars) | Sessões inválidas; ninguém entra |
| `DATABASE_URL` | `health` 503, aplicação inutilizável |
| `LLM_API_KEY` | Apenas o chat fica indisponível |
| `ADMIN_AUTH_SECRET` (≥32 chars) | Sessões do backoffice inválidas |
| `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` / `EVOLUTION_INSTANCE` | Webhook do WhatsApp não processa |

**Trocar `ENCRYPTION_KEY` invalida todas as credenciais existentes** (AES-GCM
falha na autenticação da tag). Se for inevitável: recrie as credentials no Ops
(`POST /api/v1/tenants/<TENANT>/credentials`) e atualize o `credentialId` de cada fonte.

Segredos vêm exclusivamente do ambiente. Nenhum arquivo `.env` entra na imagem
(`.dockerignore`); confira com:

```bash
docker run --rm --entrypoint sh tactia-web -c 'find / -maxdepth 4 -name ".env" 2>/dev/null'
```

## 8. Deploy e migrations

```bash
cp .env.example .env.production   # preencha os valores reais
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d --build
```

O serviço `migrate` roda `prisma migrate deploy` e o `web` só sobe depois que ele
termina com sucesso. Ordem: `postgres` (healthy) → `migrate` (exit 0) → `web`.

> **Atenção:** variáveis já exportadas no shell têm precedência sobre `--env-file`
> no docker compose. Se o container subir apontando para `localhost:5433`, o seu
> shell tem um `DATABASE_URL` de desenvolvimento exportado. Rode
> `env -u DATABASE_URL -u ENCRYPTION_KEY ... docker compose ...` ou abra um shell limpo.

Rollback: `docker compose ... up -d --no-deps web` com a imagem anterior. Migrations
são forward-only; um rollback de schema tem que ser feito com uma migration nova.

Aplicar migrations sem subir o app:

```bash
docker compose -f docker/docker-compose.prod.yml --env-file .env.production run --rm migrate
```

## 9. Backup e restauração

```bash
# backup
docker compose -f docker/docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > tactia-$(date +%F).dump

# restore (destrutivo — confirme o alvo antes)
docker compose -f docker/docker-compose.prod.yml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < tactia-AAAA-MM-DD.dump
```

O backup do banco **não** cobre `ENCRYPTION_KEY`: guarde a chave separadamente ou
as credenciais restauradas ficam ilegíveis.

## 10. Ações e aprovações

| Sintoma | Onde olhar |
|---|---|
| Ação não executou | `GET /api/v1/action-executions?status=awaiting_approval` — falta aprovação de owner/admin |
| Execução `failed` | O campo `error` (`CÓDIGO: mensagem`) + `grep '"operation":"action:'` |
| Execução duplicada | Não deveria acontecer: `Idempotency-Key` e o guard de status impedem; se ocorrer, colete os dois ids e o `request_id` |
| E-mail não chegou | O driver padrão é `console`: o "envio" é uma linha de log. Provider real é pendência |

Uma execução `failed` não é reexecutada automaticamente (sem retry na V0.1):
proponha de novo, com uma `Idempotency-Key` nova.

## 11. Isolamento entre tenants

Um usuário só alcança o tenant do próprio cookie `tactia-tenant-id`, validado
contra o membership a cada requisição. Recurso de outro tenant responde
`NOT_FOUND` (não 403, para não revelar existência).

O único caminho cross-tenant é o app `apps/admin` (Tactia Ops). As rotas
`/api/v1/tenants*` do Ops exigem sessão de operador (`operator_auth_*`) e
gravam audit log com `actorType: 'operator'` e `operatorId`:

```bash
curl -s -b cookies.txt "https://SEU-HOST/api/v1/audit-logs?pageSize=50" | jq \
  '.data.items[] | select(.actorType=="operator")'
```

## 12. Escalada

Antes de pedir ajuda, colete:

1. `request_id` do response (header `x-request-id`).
2. A linha de log correspondente.
3. `tenant_id`, e `sync_job_id`/`execution_id` quando aplicável.
4. `GET /api/v1/audit-logs` do período.
5. `docker compose ps` e `docker inspect <container> --format '{{.State.Health}}'`.

## 13. Jobs (pg-boss)

Com `JOBS_ENABLED=true` o `instrumentation.ts` sobe o worker. O tick horário
`intelligence.tick` enfileira `intelligence.daily` às **03:00 no fuso do tenant**.
Esse job **primeiro** sincroniza as fontes SQL ativas (incremental: cadastros
completos, fatos dos últimos 3 meses, só o que mudou) e depois roda snapshots,
insights e embed. Segundas também geram `briefing.weekly`. O job diário expira
em 2h (sync + pipeline).

CSV/MCP ficam de fora do cron — use **Disparar sync** no Ops. Vendas (e outros
fatos) com mais de 3 meses só entram no sync **completo** do Ops. Sem coluna de
data mapeada (`sold_at`, `occurred_at`…), o fato é pulado e o relatório de
qualidade traz `incremental_missing_date_column`.

Fallback sem fila: `POST /api/v1/intelligence/daily` com
`Authorization: Bearer $CRON_SECRET` (ou header `x-cron-secret`).

```bash
# O worker está vivo?
docker compose -f docker/docker-compose.prod.yml logs web | grep intelligence.tick

# Rodar o ciclo diário na hora (cron externo)
curl -X POST https://SEU-HOST/api/v1/intelligence/daily \
  -H "Authorization: Bearer $CRON_SECRET"
```

Se `JOBS_ENABLED` estiver off, sync e ações continuam **inline** no request.

## 13.1 Agentes externos (MCP)

Clientes MCP (Claude Desktop, outro agente interno) chamam `POST /api/v1/mcp` com uma API key do tenant. Isso executa as **mesmas tools** do chat. Números vêm no JSON `data` + `sources`. Se o cliente MCP **escrever** uma frase com número inventado, a Tactia não intercepta — o guardrail de prosa vale no orchestrator do chat. Ações (`propose_action`) entram na fila de aprovação.

Owner/admin emite a key em `/settings/api-keys` (o secret aparece **uma vez**). Não use `CRON_SECRET` aqui — é segredo de plataforma, não de tenant.

## 13.2 Chat via WhatsApp (Evolution API)

Owner/admin autoriza números em `/settings/whatsapp`. Cada número pertence a um
usuário da empresa e usa o mesmo assistente do `/chat`.

O webhook é `POST /api/v1/webhooks/evolution` (sempre 200). Configure na Evolution
o evento `MESSAGES_UPSERT` e o header `apikey` igual a `EVOLUTION_WEBHOOK_SECRET`
(ou `EVOLUTION_API_KEY` se o secret não estiver definido). Use o **nome** da
instância em `EVOLUTION_INSTANCE`, não o UUID.

| Sintoma | Causa | Ação |
|---|---|---|
| Mensagem autorizada sem resposta | `EVOLUTION_*` ausente ou instância errada | Conferir env, `grep Evolution` nos logs |
| Número cadastrado, bot ignora | Número normalizado diferente (DDI) | Cadastre com DDI, ex. `5511999999999` |
| Eco / loop | Webhook processou `fromMe` | Esperado ignorar; se persistir, filtre `SEND_MESSAGE` na Evolution |
| `/nova` no WhatsApp | Comando de nova thread | Responde "Nova conversa iniciada" |

```bash
# Listar tools (Accept precisa dos dois tipos; o SDK Streamable HTTP exige)
curl -s https://SEU-HOST/api/v1/mcp \
  -H "Authorization: Bearer tactia_live_<prefix>_<secret>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Configuração típica no cliente:

```json
{
  "url": "https://<host>/api/v1/mcp",
  "headers": { "Authorization": "Bearer tactia_live_..." }
}
```

Limite: 60 req/min por key. `GET`/`DELETE` na mesma path existem só para o transporte Streamable HTTP (SSE / teardown); o fluxo útil é `POST`.

## 14. Limitações conhecidas da V0.1

| Limitação | Impacto |
|---|---|
| Sync e execução rodam **inline** no request quando `JOBS_ENABLED=false` | Import muito grande pode estourar o timeout do proxy; quebre o arquivo ou ligue a fila |
| Rate limit **in-memory** | Vale por processo; com mais de uma instância o limite efetivo é multiplicado |
| Sem retry de execução falha | Reproponha manualmente |
| E-mail só no driver `console` | Nenhum e-mail sai de verdade |

## Conector Trello

### Fonte não conecta ou entrou em `error`

1. No Ops, use **Testar conexão**. Falhas de refresh ou `401` indicam grant expirado/revogado; abra o wizard e autorize novamente.
2. Confirme no app Trello os scopes `read:board:trello` e `read:member:trello`, e que o usuário autorizado acessa todos os `boardIds`.
3. Procure logs com `operation=sync`, `data_source_id` e `sync_job_id`. Authorization code, verifier, client secret e tokens nunca aparecem nos logs.
4. `429` é repetido automaticamente; ocorrências contínuas indicam concorrência excessiva para o mesmo token/cliente OAuth.

### Webhook não entrega

1. Confirme `TRELLO_CALLBACK_BASE_URL` HTTPS público, certificado válido e porta 443.
2. Execute `HEAD /api/v1/webhooks/trello/{sourceId}?tenantId={tenantId}` e espere `200`.
3. Confira `webhookStatus`, `webhookLastReceivedAt` e `webhooks` na configuração exibida pelo Ops.
4. Se o status estiver `pending`, habilite `JOBS_ENABLED=true`; a próxima reconciliação horária tenta registrar os quadros ausentes.
5. Mudanças na URL exigem recriar webhooks, pois a URL exata participa da assinatura HMAC.

### Dados desatualizados ou evento perdido

O worker `trello.reconcile` é publicado pelo `intelligence.tick` a cada hora. Verifique se o processo Node iniciou pg-boss e procure `job_start`, `job_complete` ou `job_failed` para esse nome. Um sync manual também reconcilia a fonte. O estado atual é recuperável; ações exclusivas de webhook que nunca chegaram não podem ser reconstruídas pela API do Trello.

### Privacidade e retenção

O worker `trello.privacy` roda diariamente às 04:00 UTC. Para o polling oficial de privacidade, configure `TRELLO_PLUGIN_ID`, `TRELLO_OAUTH_CLIENT_ID` e `TRELLO_OAUTH_CLIENT_SECRET`. Sem essas variáveis, a retenção por `historyDays` continua ativa, mas eventos de conta do Trello não são consultados. Consulte [conector-trello.md](conector-trello.md) para o modelo de dados e procedimento completo.
