# Etapa 7 — Execution (Actions e Approvals)

**Status:** concluída  
**Data:** 2026-08-30  
**Depende de:** [Etapa 1](./etapa-1.md), [Etapa 5](./etapa-5.md) — integra com a [Etapa 6](./etapa-6.md)

## Entregue

### Modelo e persistência

Migration `20260830220000_execution` adiciona:

| Modelo | Descrição |
|---|---|
| `Action` | Catálogo do que a Tactia sabe executar no tenant: tipo, configuração, `requires_approval`, `enabled` |
| `ActionExecution` | Cada execução: `origin`, `status`, `input`, `output`, `error`, `idempotency_key`, timestamps |
| `Approval` | Pedido de aprovação humana: quem pediu, quem decidiu, motivo, `resolved_at` |

Novos enums: `ActionType` (`create_task`, `send_email`, `send_whatsapp`, `generate_report`), `ActionExecutionStatus` (`pending`, `awaiting_approval`, `approved`, `running`, `completed`, `failed`, `cancelled`), `ApprovalStatus` (`pending`, `approved`, `rejected`).

Constraints e índices: `@@unique([tenantId, type])` em actions (catálogo, uma definição por tipo); `@@unique([tenantId, idempotencyKey])` em action_executions (idempotência por tenant, spec §52); `(tenantId, status)` e `(tenantId, createdAt)` em executions e approvals; `(actionId)` e `(actionExecutionId)`.

### packages/database

- `ActionRepository` — `create`, `findById`, `findByType`, `list`, `update`.
- `ActionExecutionRepository` — `create`, `findById`, `findByIdempotencyKey`, `list`, `update` (leituras já trazem `action` e `approvals`).
- `ApprovalRepository` — `create`, `findById`, `findPendingByExecution`, `list`, `resolve`.

### packages/execution

| Arquivo | Descrição |
|---|---|
| `src/action-registry.ts` | `defineAction()` + `ActionRegistry`: input schema Zod + executor por tipo |
| `src/actions/create-task.ts` | Cria `Activity` do tipo `task` |
| `src/actions/send-email.ts` | Envia via `EmailSender` |
| `src/email-sender.ts` | `ConsoleEmailSender` (driver de dev) e `MemoryEmailSender` (testes) |
| `src/job-queue.ts` | `InlineJobQueue` — implementa a porta `JobQueue` |
| `src/execution-engine.ts` | Lifecycle completo: propose → validate → approval → run → output/erro |
| `src/action-service.ts` | Catálogo de ações + leitura de execuções |
| `src/approval-service.ts` | Fila de aprovações + approve/reject |
| `src/schemas.ts` | Schemas Zod das fronteiras de API |

#### Ações da V0.1

| Tipo | Input | Output | Efeito |
|---|---|---|---|
| `create_task` | `{ title, description?, dueDate?, customerId?, leadId?, sellerId? }` | `{ activityId, title, occurredAt }` | `Activity` do tipo `task` com `metadata.source = "action"` |
| `send_email` | `{ to, subject, body, cc? }` | `{ messageId, driver, to, subject, cc? }` | Envio pelo driver configurado (`console` em dev) |

`send_whatsapp` e `generate_report` existem no enum (espelham a spec §30) mas **não têm executor**: propor ou catalogar esses tipos retorna `VALIDATION_ERROR`. O registry é a fonte da verdade sobre o que é executável.

`Action.configuration` alimenta o executor — hoje `send_email` usa `configuration.defaultCc`.

#### Lifecycle (spec §44–45)

```text
propose(actionId | actionType, input, Idempotency-Key?)
  ↓  registry.validate(type, input)          → VALIDATION_ERROR antes de persistir nada
  ↓  Idempotency-Key já usada?               → devolve a execução original
  ↓  requires_approval || origin === 'ai'
        ├── sim → status awaiting_approval + Approval(pending)
        └── não → status pending → JobQueue.enqueue
                                     ↓
                                   run(): running → executor → completed (output)
                                                            └→ failed (error)
approve(approvalId) → status approved → JobQueue.enqueue → run()
reject(approvalId)  → status cancelled (nunca executa)
cancel(executionId) → status cancelled + approval pendente resolvida
```

Garantias:

- Um input inválido **não cria linha nenhuma** — a validação acontece antes do insert.
- `run()` só aceita `pending` ou `approved`; qualquer outra coisa é `CONFLICT`. Isso bloqueia execução sem aprovação e execução dupla.
- O input é **revalidado no momento da execução** (defesa em profundidade: a proposta pode ter ficado horas na fila).
- Falha do executor nunca propaga como exceção: vira `status: failed` + `error` classificado + audit `ACTION_FAILED`. O registro *é* o contrato.
- `Idempotency-Key` repetida devolve a execução original; a mesma chave em outro tenant é uma execução diferente. A corrida entre dois requests simultâneos é tratada capturando a violação de unicidade (P2002).

#### Integração com a IA (Etapa 6)

O orchestrator ganhou a tool `propose_action`, registrada apenas quando um `ActionProposalPort` é injetado:

```text
LLM → propose_action (tool)
        ↓ Zod (actionType ∈ {create_task, send_email})
      ExecutionEngine.proposeFromAi
        ↓ Zod do action schema
      ActionExecution(status = awaiting_approval, origin = 'ai')
        ↓
      fila de aprovação humana
```

- Proposta da IA **sempre** exige aprovação, mesmo que a `Action` esteja configurada com `requiresApproval: false`.
- `packages/ai` não depende de `@tactia/execution`: define o port `ActionProposalPort` e `apps/web` liga o engine nele.
- A proposta volta em `ToolResult.proposal`, é agregada em `ChatAnswer.proposals`, persistida em `Message.metadata.proposals` e emitida no SSE (`tool_result.proposal` e `done.proposals`) — é o que a Etapa 8 usa para desenhar o botão de aprovação.
- A regra 7 do system prompt muda quando a tool está registrada: o modelo é instruído a dizer que a ação ficou **pendente de aprovação**, nunca que foi executada.

### Rotas API

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `GET` | `/api/v1/actions` | tenant | Catálogo do tenant + `available` (tipos executáveis). `mode=definitions` retorna só os tipos |
| `POST` | `/api/v1/actions` | owner/admin | Cria definição (`{ type, name?, description?, configuration?, requiresApproval?, enabled? }`) |
| `GET` | `/api/v1/actions/:id` | tenant | Obtém definição |
| `PATCH` | `/api/v1/actions/:id` | owner/admin | Atualiza nome, configuração, `requiresApproval`, `enabled` |
| `POST` | `/api/v1/actions/defaults` | owner/admin | Provisiona as definições built-in (idempotente) |
| `POST` | `/api/v1/actions/:id/execute` | member+ | Propõe execução dessa ação (`{ input, reason? }`) |
| `GET` | `/api/v1/action-executions` | tenant | Lista execuções (`status`, `actionId`, `page`, `pageSize`) |
| `POST` | `/api/v1/action-executions` | member+ | Propõe por `actionId` **ou** `actionType` |
| `GET` | `/api/v1/action-executions/:id` | tenant | Registro completo: input, output, erro, timestamps, approvals |
| `POST` | `/api/v1/action-executions/:id/cancel` | member+ | Cancela o que ainda não rodou |
| `GET` | `/api/v1/approvals` | tenant | Fila de aprovações (padrão `status=pending`) |
| `GET` | `/api/v1/approvals/:id` | tenant | Detalhe com a execução e a ação |
| `POST` | `/api/v1/approvals/:id/approve` | owner/admin | Aprova **e executa**; a resposta já traz output ou erro |
| `POST` | `/api/v1/approvals/:id/reject` | owner/admin | Rejeita (`{ reason? }`); a execução é cancelada |

`Idempotency-Key` é aceita como header nas duas rotas de proposta (`/actions/:id/execute` e `/action-executions`); máximo de 200 caracteres.

### Audit logs

`ACTION_CREATED`, `ACTION_UPDATED`, `ACTION_PROPOSED` (com `actorType: 'ai'` quando vem do chat), `ACTION_APPROVED`, `ACTION_REJECTED`, `ACTION_EXECUTED` (com o output), `ACTION_FAILED` (com o erro), `ACTION_CANCELLED`.

### Testes

**`packages/execution` — 24 testes** em Postgres real (`src/__tests__/execution.test.ts`):

- `ActionRegistry`: expõe só os tipos com executor; `send_whatsapp` é rejeitado; `validate` aceita/recusa payloads.
- Ação com aprovação obrigatória fica em `awaiting_approval`, **não cria a tarefa** e `run()` direto retorna `CONFLICT`.
- Aprovar executa: status `completed`, `output.activityId` existe, a `Activity` criada é do tipo `task` com `metadata.actionExecutionId`, o approval registra `approvedBy`/`resolvedAt` e os audit logs `ACTION_PROPOSED` + `ACTION_APPROVED` + `ACTION_EXECUTED` estão gravados.
- Rejeitar cancela a execução, não cria nada e grava `ACTION_REJECTED`.
- Ação sem aprovação executa na hora e aplica `configuration.defaultCc`.
- Falha do sender → `status: failed`, `error` preenchido, `finishedAt` definido e `ACTION_FAILED` no audit.
- Referência a dado de outro tenant → execução `failed` com `NOT_FOUND` (nada é escrito).
- Input inválido → `VALIDATION_ERROR` e **zero** execuções persistidas.
- `Idempotency-Key` repetida devolve a mesma execução (1 linha no banco); a mesma chave em outro tenant cria outra.
- Executar duas vezes a mesma execução → `CONFLICT` (uma tarefa só).
- `cancel` resolve o approval pendente e recusa cancelamento em duplicidade.
- Proposta da IA: sempre `awaiting_approval`, `origin: 'ai'`, audit com `actorType: 'ai'`, nada executado; tipo não suportado → `VALIDATION_ERROR`.
- Papéis: viewer não propõe (`AUTHORIZATION_ERROR`), member não aprova.
- Isolamento: outro tenant não lê a execução, não aprova, não executa e vê fila vazia.
- `ensureAction` provisiona a definição no primeiro uso; ação desabilitada → `VALIDATION_ERROR`.
- `ActionService`: `seedDefaults` idempotente, `list` com `available`, tipo sem executor bloqueado, tipo duplicado → `CONFLICT`, member não cria, filtro por status.

**`packages/ai` — 7 testes novos** (`src/__tests__/propose-action.test.ts`): tool registrada só com `actionProposer` (7 tools no total); payload repassado ao engine; `proposal` no `ToolResult` sem `sources`; `send_whatsapp` recusado; `ChatAnswer.proposals`; `tool_result.proposal` e `done.proposals` no streaming; erro do engine vira erro de tool que o modelo explica; system prompt troca a regra 7.

**Total do monorepo: 101 testes** (`shared` 2, `intelligence` 22, `ai` 34, `execution` 24, `domain` 19). `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build` passam (9/9 tasks), com 4 execuções consecutivas da suíte sem falha.

#### Correção de flakiness (bug pré-existente)

A suíte falhava de forma intermitente ao rodar duas vezes em sequência. Causa raiz: `sync-idempotency.test.ts` montava o e-mail da fixture com `tenantId.slice(0, 8)` — os 8 primeiros hex de um UUID v7 são temporais e só mudam a cada ~65 s — e o `afterAll` só apagava o tenant, deixando `authUser`/`user` para trás. A colisão de `unique(email)` só não aparecia porque `tenant-isolation.test.ts` apagava *todos* os `authUser` terminando em `.com` e `canonical-data.test.ts` *todos* terminando em `.test`.

Correções: a fixture usa o id completo (`sync-test-<uuid>@sync.local`) e limpa as próprias linhas de identidade; `tenant-isolation` e `canonical-data` passaram a limpar apenas suas fixtures (lista explícita de e-mails) e não abortam mais a limpeza de identidade quando não há tenants.

## Decisões

- **Executores recebem repositories e ports, não services de domínio.** Uma execução pode rodar depois do request que a propôs (aprovação, fila), então não existe sessão para autorizar. A autorização acontece ao propor (member+) e ao aprovar (owner/admin); o executor apenas revalida as referências (cliente/lead/vendedor do tenant).
- **`InlineJobQueue` como driver da V0.1**, atrás da porta `JobQueue`. A execução é aguardada no request: determinística para testes e correta em serverless (um timer em background seria morto após a resposta). O driver pg-boss (spec §46) implementa a mesma interface e entra no wiring de `apps/web` sem tocar no engine — mesma decisão da Etapa 3 para o sync.
- **Aprovação é de owner/admin.** A spec não fixa o papel; owner/admin é o padrão mais seguro e fácil de relaxar depois. Não há regra de "quatro olhos": quem propõe pode aprovar se for admin.
- **Um `Action` por tipo por tenant** (`unique(tenantId, type)`). Torna a resolução por tipo (caminho da IA) inequívoca e é suficiente para a V0.1; variações por destinatário/canal ficam em `configuration`.
- **Tipos sem executor ficam no enum, mas são recusados pelo registry.** O enum espelha a spec §30 (`send_whatsapp`, `generate_report`), e o gate no registry impede criar execução que nunca rodaria.
- **`origin` (`user` | `ai` | `system`) no `ActionExecution`** em vez de inferir pelo `actorType` do audit log: é o que permite forçar aprovação para o caminho da IA e filtrar depois no painel.
- **`ensureAction` provisiona a definição no primeiro uso.** Evita que a IA ou a API falhem por catálogo vazio; `POST /api/v1/actions/defaults` e o seed fazem o mesmo explicitamente.
- **Sem FK de `requested_by`/`approved_by` para `users`.** São colunas UUID simples, como em outros modelos analíticos; usuários são soft-deleted, então não há risco prático de referência órfã, e evita três relações extras no `User`.
- **`packages/ai` define o port, `packages/execution` o satisfaz estruturalmente.** Nenhum dos dois pacotes importa o outro; a ligação é feita em `apps/web/src/lib/ai.ts`. Isso mantém a Etapa 6 utilizável sem execução (chat read-only) — basta não injetar o `actionProposer`.
- **Erro do executor é persistido como `CODE: mensagem`** (ex. `NOT_FOUND: Cliente informado não existe`), sem stack trace, e o erro completo vai para o log estruturado.

## Como testar manualmente

```bash
docker compose -f docker/docker-compose.yml up -d
pnpm db:migrate:deploy
pnpm db:seed          # owner@demo.tactia / password123 (já cria as ações padrão)
pnpm dev
```

1. Login em http://localhost:3000/login.
2. Ver o catálogo: `GET /api/v1/actions` → `create_task` e `send_email` com `requiresApproval: true`.
3. Propor uma ação:

```bash
curl -X POST http://localhost:3000/api/v1/action-executions \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-1' -b cookies.txt \
  -d '{"actionType":"create_task","input":{"title":"Ligar para o cliente ABC"},"reason":"Cliente inativo"}'
# → status: awaiting_approval, approvals[0].status: pending
```

4. Repetir o mesmo comando (mesma `Idempotency-Key`) → devolve a **mesma** execução, sem duplicar.
5. Ver a fila: `GET /api/v1/approvals` → o pedido pendente.
6. Aprovar: `POST /api/v1/approvals/<approvalId>/approve` → resposta com `status: completed` e `output.activityId`.
7. Conferir o efeito: `GET /api/v1/activities?type=task` → a tarefa criada.
8. Conferir a trilha: `GET /api/v1/audit-logs` → `ACTION_PROPOSED`, `ACTION_APPROVED`, `ACTION_EXECUTED`.
9. Testar rejeição: propor outra ação e `POST /api/v1/approvals/<id>/reject` → execução `cancelled`, nada criado.
10. Testar falha: `PATCH /api/v1/actions/<sendEmailId>` com `{"requiresApproval": false}` e propor `send_email` com um `to` válido — o driver `console` registra o envio no log; para ver o caminho de erro, use um `to` inválido e observe `VALIDATION_ERROR` (input) ou configure um driver que falhe para ver `status: failed`.
11. Pelo chat (precisa de `LLM_API_KEY`): "crie uma tarefa para ligar para o cliente ABC amanhã" → a resposta traz `proposals[0]` com `status: awaiting_approval` e a ação aparece em `GET /api/v1/approvals`.

Testes automatizados:

```bash
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test pnpm --filter @tactia/execution test
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test pnpm --filter @tactia/ai test
```

## Critérios de aceite (spec §59 — Execution)

| Item | Evidência |
|---|---|
| É possível criar uma ação | `POST /api/v1/actions` + `seedDefaults`; testes de `ActionService` |
| Ação pode exigir aprovação | `requires_approval` + `Approval` pendente; teste "parks an action that requires approval and does not execute it" |
| Execução é registrada | `ActionExecution` com input, output, `startedAt`/`finishedAt` e audit `ACTION_EXECUTED`; teste "executes after approval and records the full trail" |
| Falhas são registradas | `status: failed` + `error` classificado + `ACTION_FAILED`; testes de falha do sender e de referência cruzada entre tenants |

Extras do plano: `Idempotency-Key` comprovada por teste; IA propõe sem nunca executar (spec §44).

## Pendências (próximas etapas)

- **Etapa 8:** fila de aprovações na UI, botão de aprovar/rejeitar no chat a partir de `metadata.proposals` e histórico de execuções no admin.
- **Driver pg-boss** para a porta `JobQueue` (hoje inline) e retry/backoff de execuções falhas.
- **Provider real de e-mail** (SES/Resend) implementando `EmailSender`; hoje só o driver `console`.
- `send_whatsapp` e `generate_report` continuam sem executor — fora do escopo da V0.1.
- Ações disparadas automaticamente a partir de uma `Recommendation` aceita (hoje a proposta é sempre manual ou via chat).
