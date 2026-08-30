# Etapa 6 — AI e Chat

**Status:** concluída  
**Data:** 2026-08-30  
**Depende de:** [Etapa 4](./etapa-4.md), [Etapa 5](./etapa-5.md)

## Entregue

### Modelo e persistência

Migration `20260830210000_ai_chat` adiciona:

| Modelo | Descrição |
|---|---|
| `Conversation` | Conversa entre usuário e Tactia (tenant, autor, título) |
| `Message` | Mensagem da conversa: `role`, `content`, `metadata` (fontes, tool calls, modelo) |

Novo enum: `MessageRole` (`user`, `assistant`, `system`, `tool`).

Índices: `(tenant_id, created_at)` e `(tenant_id, user_id, updated_at)` em conversations; `(conversation_id, created_at)` e `(tenant_id, created_at)` em messages. `Message` sem soft delete (histórico é append-only).

### packages/database

- `ConversationRepository` — `create`, `findById`, `findByIdWithMessages`, `list`, `updateTitle`, `touch`, `delete`.
- `MessageRepository` — `create`, `findById`, `listByConversation`, `listRecent` (últimas N em ordem cronológica), `count`.

### packages/domain

- `ConversationService` — criar/listar/obter conversa, anexar mensagem, histórico recente e `renameFromFirstMessage`. Sem nenhuma dependência de IA: o orchestrator produz a resposta, o service persiste.
- `AuditAction.CONVERSATION_CREATED`.
- `schemas/ai.ts` — `createConversationSchema`, `listConversationsQuerySchema`, `sendMessageSchema`, `appendMessageSchema`.

### packages/ai

| Arquivo | Descrição |
|---|---|
| `src/types.ts` | `ToolContext`, `MessageSource`, `Tool`, `LLMAdapter` e tipos de chat |
| `src/tool-registry.ts` | `defineTool()` + `ToolRegistry` (validação Zod, erros classificados, log por tool) |
| `src/tools/*.ts` | As 6 tools da V0.1 |
| `src/context-builder.ts` | `ContextBuilder` — empresa + métricas do período + insights abertos |
| `src/system-prompt.ts` | System prompt em pt-BR com as regras de segurança |
| `src/adapters/vercel-llm-adapter.ts` | `LLMAdapter` sobre o Vercel AI SDK (`ai@7`, `@ai-sdk/openai@4`) |
| `src/adapters/mock-llm-adapter.ts` | `MockLLMAdapter` determinístico para testes |
| `src/orchestrator.ts` | Loop user → contexto → tools → resposta validada, com `run()` e `stream()` |
| `src/config.ts` | `createLLMAdapterFromEnv` / `requireLLMAdapter` |

#### Tools da V0.1

| Tool | Retorna | Fontes (`sources`) |
|---|---|---|
| `get_revenue` | Receita do período, comparação e breakdown (dia/semana/mês, produto, vendedor) | `revenue` |
| `get_sales` | Nº de vendas, ticket médio, crescimento e vendas recentes | `sales_count`, `average_ticket`, `sales_growth` |
| `get_customers` | Clientes únicos no período + lista de clientes cadastrados | `customer_count` |
| `get_products` | Ranking de produtos por receita | `revenue` |
| `get_sellers` | Ranking de vendedores + receita média por vendedor | `revenue` |
| `get_insights` | Insights abertos com evidência e recomendações pendentes | evidência de cada insight + `insights` |

Toda tool delega para os **mesmos services usados pela API REST** (`MetricService`, `CustomerService`, `ProductService`, `SellerService`, `SaleService`, `InsightService`, `RecommendationService`). Nenhuma tool recebe `PrismaClient`, nem existe tool genérica de query — não há caminho de acesso arbitrário da IA ao banco.

#### Fluxo do orchestrator (spec §41)

```text
pergunta do usuário
  ↓
ContextBuilder (empresa, métricas do mês, insights abertos)  →  system prompt
  ↓
LLMAdapter.complete/stream com as definições das tools
  ↓  (tool calls)
ToolRegistry.execute → valida input (Zod) → service de domínio → { data, sources }
  ↓  (tool results voltam como mensagens role=tool)
LLM produz o texto final
  ↓
finalize(): dedup de sources + guardrails → ChatAnswer
```

O loop é nosso, não do SDK: as tools são declaradas **sem `execute`**, então o SDK devolve as tool calls e o Tactia é quem valida, escopa por tenant e coleta evidência.

#### AI Safety (spec §43)

- Cada tool retorna `sources: MessageSource[]` (`metric`, `period`, `value`, `tool`, `label`); as métricas injetadas no contexto também viram fontes (`tool: "context"`).
- `sources` são deduplicadas por `metric + período`; quando há empate, a fonte vinda de tool substitui a do contexto (foi calculada para aquela pergunta).
- Guardrail `unsourced_numbers`: se a resposta contém dígitos e não há nenhuma fonte, o texto é substituído por uma mensagem segura e o motivo fica em `metadata.guardrail`.
- Guardrail `max_iterations`: esgotado o orçamento de tool calls, é feita uma chamada final **sem tools** para fechar a resposta com os dados já obtidos.
- Falha de tool não derruba o chat: o erro volta ao modelo como `{ "error": "..." }` e fica registrado em `metadata.toolCalls[].error`.
- Falha do provider → `AppError(AI_ERROR)` (HTTP 502).

### Rotas API

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `GET` | `/api/v1/conversations` | tenant | Lista as conversas do usuário (`page`, `pageSize`) |
| `POST` | `/api/v1/conversations` | tenant | Cria conversa (`{ title? }`) |
| `GET` | `/api/v1/conversations/:id` | tenant | Conversa + histórico completo |
| `GET` | `/api/v1/conversations/:id/messages` | tenant | Mensagens (com `metadata.sources`) |
| `POST` | `/api/v1/conversations/:id/messages` | tenant | Envia pergunta e recebe a resposta (`{ content, stream? }`) |

**Resposta sem streaming** (`stream` ausente/false):

```json
{
  "data": {
    "userMessage": { "id": "...", "role": "user", "content": "Quanto vendemos este mês?" },
    "message": { "id": "...", "role": "assistant", "content": "...", "metadata": { "sources": [...] } },
    "answer": {
      "content": "A receita de agosto foi de R$ 12.400,00, 18% abaixo de julho.",
      "sources": [
        { "metric": "revenue", "period": { "from": "2026-08-01T...", "to": "2026-09-01T..." }, "value": 12400, "tool": "get_revenue", "label": "revenue — 01/08/2026 a 01/09/2026" }
      ],
      "toolCalls": [{ "name": "get_revenue", "input": { "compareWithPreviousPeriod": true }, "durationMs": 42 }],
      "provider": "openai",
      "model": "gpt-4o-mini"
    }
  }
}
```

**Resposta com streaming** (`{ "content": "...", "stream": true }`): `text/event-stream`, um JSON por evento em `data:`.

| `type` | Payload |
|---|---|
| `start` | `conversationId`, `userMessageId` |
| `tool_call` | `name`, `input` |
| `tool_result` | `name`, `sources`, `error?` |
| `text` | `delta` |
| `done` | `messageId`, `content`, `sources`, `toolCalls`, `provider`, `model`, `guardrail?` |
| `error` | `code`, `message` |

A mensagem do assistente é persistida antes do evento `done` — o `messageId` já é o registro definitivo.

### Configuração (env)

| Variável | Default | Descrição |
|---|---|---|
| `LLM_PROVIDER` | `openai` | Rótulo do provider; `mock` usa o adapter determinístico (sem rede) |
| `LLM_API_KEY` | — | Sem ela, as rotas de chat respondem `AI_ERROR` (o app sobe normalmente) |
| `LLM_MODEL` | `gpt-4o-mini` | Modelo |
| `LLM_BASE_URL` | — | Endpoint compatível com OpenAI (Azure, Groq, OpenRouter, Ollama...) |

### Testes

**`packages/ai` — 27 testes** (3 arquivos):

- `tool-registry.test.ts` (5, unit): registro/listagem, `CONFLICT` em nome duplicado, `NOT_FOUND` em tool inexistente, `VALIDATION_ERROR` em input inválido, defaults do schema aplicados quando o modelo omite campos.
- `orchestrator.test.ts` (10, unit com `MockLLMAdapter`): resposta construída a partir do tool result com evidência; tool output reinjetado na 2ª chamada; contexto estruturado presente no system prompt; guardrail `unsourced_numbers`; texto sem números preservado; falha de tool reportada ao modelo; input inválido vira erro de tool; falha do LLM → `AI_ERROR`; `max_iterations` com chamada final sem tools; `historyLimit`; `stream()` emitindo `tool_call` → `tool_result` → `text` → `done`.
- `tools.test.ts` (12, integração Postgres): as 6 tools registradas; `get_revenue` = 1000 com comparação −50% vs. período anterior; breakdown por vendedor; `get_sales` com 3 vendas, ticket médio e crescimento; ranking de produtos e de vendedores; `get_customers` com 2 clientes únicos; `get_insights` expondo a evidência `revenue_growth`; **isolamento entre tenants** (o tenant B não vê nada do A); tool sem tenant ativo → `AUTHENTICATION_ERROR`; `VALIDATION_ERROR` para limite fora da faixa e período invertido; `ContextBuilder` montando empresa + 4 métricas + insight + fontes.

**`packages/domain` — `conversation.test.ts` (6, integração)**: audit `CONVERSATION_CREATED`; título derivado da primeira mensagem; `metadata.sources` persistido e recuperado; listagem restrita ao próprio usuário; conversa invisível para outro membro (admin lê); `NOT_FOUND` para outro tenant (leitura e escrita); `recentMessages` devolvendo apenas as últimas N.

**Total do monorepo: 70 testes** (`shared` 2, `intelligence` 22, `ai` 27, `domain` 19). `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build` passam (9/9 tasks).

## Decisões

- **Loop de tools próprio, não o do SDK.** As tools são passadas ao Vercel AI SDK sem `execute`, o que devolve as tool calls para o orchestrator. Assim a validação Zod, o escopo de tenant, a coleta de evidência e os guardrails ficam em código nosso e continuam válidos ao trocar de provider.
- **`LLMAdapter` como fronteira única.** Todo o resto do código depende só da interface (`complete` + `stream` opcional). O `MockLLMAdapter` cobre os testes sem rede; `LLM_BASE_URL` cobre qualquer endpoint compatível com OpenAI.
- **`ToolContext` é um `RequestContext` estreitado** (`tenantId`/`userId`/`role` não nulos). A spec §42 pede `{ tenantId, userId }`; incluir `role` e `requestId` permite chamar os services de domínio sem adaptação e mantém o log correlacionado.
- **Tools sobre services, não sobre repositories.** Custa uma camada extra, mas garante que autorização, validação e regras de negócio sejam as mesmas da API REST — a IA não tem um caminho privilegiado.
- **Contexto também é fonte.** As 4 métricas injetadas no prompt entram em `sources` com `tool: "context"`, então perguntas respondidas direto do contexto continuam auditáveis.
- **`ContextSource` em vez da classe concreta** no `OrchestratorDeps`: inverte a dependência e permite testar o orchestrator sem banco.
- **Conversas são pessoais.** `list` devolve apenas as do usuário logado; leitura de conversa alheia responde `NOT_FOUND` (não `AUTHORIZATION_ERROR`, para não revelar existência), exceto para owner/admin.
- **Viewer pode conversar.** `create`/`appendMessage` exigem apenas tenant ativo: o chat é leitura de dados que o viewer já pode ver, e a escrita se limita ao próprio histórico.
- **Streaming como SSE cru** (`data: {json}`), não o protocolo de UI do AI SDK: mantém a Etapa 8 livre para consumir com `EventSource`/`fetch` sem acoplar a UI ao SDK. Erros do LLM durante o stream chegam como evento `error` (o HTTP já respondeu 200).
- **Sem proposta de ação nesta etapa.** A regra 7 do system prompt proíbe prometer execução; propor `ActionExecution` a partir do chat entra na Etapa 7, que já roda em paralelo.
- **Fixtures de teste usam e-mails `@ai-tools.local` / `@chat.local`.** O cleanup de `canonical-data.test.ts` apaga `authUser` com e-mail terminando em `.test`, o que quebrava estes testes quando o Turborepo roda os pacotes em paralelo no mesmo banco.

## Como testar manualmente

```bash
docker compose -f docker/docker-compose.yml up -d
pnpm db:migrate:deploy
pnpm db:seed          # owner@demo.tactia / password123

# no .env
LLM_API_KEY=sk-...          # ou LLM_PROVIDER=mock para respostas simuladas
LLM_MODEL=gpt-4o-mini

pnpm dev
```

1. Login em http://localhost:3000/login.
2. `POST /api/v1/insights` para o pipeline gerar insights do seed (opcional, melhora as respostas).
3. Criar a conversa:

```bash
curl -X POST http://localhost:3000/api/v1/conversations \
  -H 'Content-Type: application/json' -b cookies.txt -d '{}'
```

4. Perguntar (as perguntas da spec §58):

```bash
curl -X POST http://localhost:3000/api/v1/conversations/<id>/messages \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"content":"Quanto vendemos este mês?"}'

# streaming
curl -N -X POST http://localhost:3000/api/v1/conversations/<id>/messages \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"content":"Quem mais vendeu?","stream":true}'
```

5. Conferir a evidência: `GET /api/v1/conversations/<id>/messages` → cada mensagem do assistente traz `metadata.sources` com `metric` e `period`.
6. Conferir o isolamento: trocar de tenant (`POST /api/v1/tenants/:id/switch`) e tentar `GET /api/v1/conversations/<id>` → `NOT_FOUND`.

Testes automatizados:

```bash
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test pnpm --filter @tactia/ai test
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test pnpm --filter @tactia/domain test
```

## Critérios de aceite (spec §59 — AI)

| Item | Evidência |
|---|---|
| Chat consulta dados reais | `tools.test.ts` valida valores exatos vindos dos services; `orchestrator.test.ts` prova que a resposta usa o tool result |
| IA não acessa banco diretamente | Tools recebem apenas services de domínio; nenhuma tool genérica de query; `ToolRegistry` é a única porta |
| Números possuem evidência | `sources` em toda tool + guardrail `unsourced_numbers`; `metadata.sources` persistido (`conversation.test.ts`) |
| Respostas contextualizadas por tenant | `ToolContext` derivado da sessão; teste de isolamento entre tenants em `tools.test.ts` |

## Pendências (próximas etapas)

- **Etapa 7:** o orchestrator poderá **propor** `ActionExecution` (`awaiting_approval`) a partir de uma recomendação — hoje o prompt proíbe prometer execução.
- **Etapa 8:** UI de chat consumindo o SSE, exibindo "Fonte: vendas entre 01/08 e 25/08" a partir de `metadata.sources` e o botão de aprovação da ação proposta.
- Tools `get_leads` e `get_metrics` (citadas na spec §42 como futuras) não entraram na V0.1, que fixa 6 tools.
- Rate limiting específico do chat (hoje só as rotas de auth têm) e limite de tokens por tenant.
