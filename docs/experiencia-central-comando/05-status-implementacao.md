# Central de comando — status de implementação

Última atualização: 29/09/2026. Branch: `feat/refact-experience`.

Este documento existe para que outro agente continue o trabalho **sem precisar
do histórico de conversa**. Ele registra o que está pronto, com qual evidência,
o que ficou pendente e por quê certas decisões foram tomadas.

Leia antes: `00-contexto-e-arquitetura.md` (premissas), `04-handoff-engenharia.md`
(contratos e critérios de aceite) e `docs/plano-experiencia-central-de-comando.md`
(estratégia de produto).

Para iniciar uma sessão nova de agente, use `06-prompt-continuacao.md`: ele já
reúne contexto, tarefa, invariantes, comandos de verificação e falhas
preexistentes que não devem consumir tempo.

## Como reproduzir a verificação

Os testes de integração exigem o banco de teste, que já tem as 7 migrações novas
aplicadas. Nunca aponte estes comandos para o banco de desenvolvimento.

```bash
export TEST_DB=postgresql://tactia:tactia@localhost:5433/tactia_test

# migrações (idempotente)
DATABASE_URL=$TEST_DB pnpm db:migrate:deploy

# ciclo plano → decisão → execução → evidência → medição
cd apps/web && DATABASE_URL=$TEST_DB pnpm exec vitest run \
  src/__tests__/command-center-cycle.test.ts \
  src/__tests__/command-center-flow.test.ts \
  src/__tests__/plan-review-decision.test.ts \
  src/lib/__tests__/command-center-flag.test.ts

# esclarecimento pontual por WhatsApp
cd apps/web && DATABASE_URL=$TEST_DB pnpm exec vitest run \
  src/lib/__tests__/clarification-flow.test.ts

# unitários de domínio
cd packages/domain && pnpm exec vitest run \
  src/__tests__/command-center-service.test.ts \
  src/__tests__/evidence-clarification-policy.test.ts

# regressão do fluxo anterior (não deve quebrar)
cd apps/web && DATABASE_URL=$TEST_DB pnpm exec vitest run src/__tests__/pilot-flow.test.ts

# preparação operacional sem recomendação
cd apps/admin && DATABASE_URL=$TEST_DB pnpm exec vitest run \
  src/lib/__tests__/settings-routes.test.ts \
  src/lib/__tests__/tenant-tabs.test.ts
```

## Estado por entrega

Referência: a sequência definida em `04-handoff-engenharia.md`.

| Entrega | Estado | Observação |
|---|---|---|
| 0 — validação com empresários | **Não iniciada** | Exige acesso a participantes; nada de código depende disso |
| 1 — semântica de confiança | **Feito** | `MetricEnvelope`-like por bloco, indisponível ≠ zero, regime de autorização real |
| 2 — shell/Hoje/Objetivos/Ops | **Feito** | 6 rotas novas + fila de lacunas; flag por empresa no Ops; rotas antigas preservadas |
| 3 — ciclo completo | **Feito** | Recomendação → plano versionado → decisão → execução → evidência → medição |
| 4 — operação consolidada | **Parcial** | Conversa contextual, revisão automática e decisão guiada prontas; revisão semanal consolidada pendente |
| 5 — piloto ampliado | **Não iniciada** | Depende de deploy e de empresa real |
| Fluxo D — esclarecimento | **Feito** | Política opt-in, orçamento, correlação e registro automático |

## O que está implementado e verificado

### Modelagem (7 migrações aditivas)

| Migração | Conteúdo |
|---|---|
| `20260928230000_command_center_slice` | `Goal` estendido; `Plan`, `PlanStep`, `PlanStepExecution`, `MeasurementDefinition`, `MeasurementReview`, `OperationalEvidence`, `EvidenceGap` |
| `20260928235000_command_center_cycle` | `planVersion` + `decisionSnapshot` no vínculo; uniques de idempotência (execução, evidência por `externalRef`, plano por recomendação) |
| `20260929002500_conversation_context` | `conversations.context_ref` para conversa contextual persistente |
| `20260929102000_evidence_clarifications` | Política de contato em `whatsapp_agent_configs` + tabela `evidence_clarifications` |
| `20260929150000_command_center_tenant_flag` | `tenants.command_center_enabled` opcional; decisão explícita prevalece sobre fallback por env |
| `20260929160000_plan_review_decisions` | Histórico versionado de decisões de revisão com snapshot da medição |
| `20260929170000_command_center_events` | Eventos deduplicados e escopados por empresa, sem texto de mensagens/contatos |

Todas são aditivas: nenhum `DROP`, nenhuma renomeação, nenhuma alteração de
semântica de coluna existente.

### Ciclo transacional

- Preparação de plano a partir de recomendação é **idempotente** (`unique(tenantId, recommendationId)` + captura de `P2002`).
- A ação sugerida é congelada em `plan.scope` e **validada antes** de chegar ao executor; payload divergente é rejeitado sem criar execução.
- `PlanStepExecution` guarda `planVersion` e `decisionSnapshot` (plano, objetivo, passo, ação, evidência, timestamp).
- Aprovar/recusar valida se a versão aprovada é a atual — em `apps/web` **e** nas rotas de chat do Ops.
- Reconciliação roda inline (rotas) e assíncrona (worker), convertendo estado de execução em estado de passo, gravando `OperationalEvidence(observed)` idempotente, abrindo lacuna em falha e iniciando medição em conclusão.
- Medição automática após sync e no job diário; sem dataset canônico, grava `null` + lacuna em vez de zero. Quando a fonte volta, a lacuna é resolvida.

Evidência (`command-center-cycle.test.ts`):
`completes the transaction without a manual status update`,
`distinguishes a true zero from unavailable data once coverage exists`,
`rejects a tampered action before it reaches the executor`,
`blocks approval after the plan version changes`.

### Esclarecimento pontual (Fluxo D)

Documentação operacional: `docs/esclarecimento-lacunas-whatsapp.md`.

- Opt-in por empresa, desativado por padrão; janela, dias, orçamento por pessoa e cooldown.
- Ops apenas **prepara**; o envio ocorre em `apps/web`, que detém o adapter Evolution. Não existe segundo caminho de envio.
- No disparo, lacuna e política são reavaliadas: lacuna resolvida cancela sem contato; fora da política falha sem contato.
- Resposta é interceptada **antes** do agente, vira `OperationalEvidence(reported)` e só resolve a lacuna quando é clara.
- Reserva atômica do slot de contato e transição atômica `sent → processing` evitam furo de orçamento e evidência duplicada.

Evidência (`clarification-flow.test.ts`, 7 casos):
`refuses to prepare a question when the company did not opt in`,
`sends once, records the reply as reported evidence and resolves the gap`,
`keeps an ambiguous reply without confirmation and does not close the gap`,
`cancels the question without contacting anyone when the gap was resolved meanwhile`,
`does not contact the person twice for the same day budget`,
`records only one evidence when two replies arrive concurrently`,
`ignores an unrelated inbound message when nothing is pending`.

### Superfícies

O Ops liga ou desliga a Central de Comando no cadastro da empresa. A mudança é
registrada na mesma transação em `audit_logs` com operador, valor anterior e
novo valor. `apps/web` lê a decisão persistida no shell; `null` preserva o
fallback `COMMAND_CENTER_TENANT_IDS` para desenvolvimento. `false` explícito
prevalece inclusive sobre `*` no fallback. A navegação legada continua quando
desligada, e suas rotas permanecem acessíveis quando ligada.

Evidência: `settings-routes.test.ts` (20/20, incluindo ligar/desligar,
auditoria, isolamento de empresas e validação) e `command-center-flag.test.ts`
(2/2, precedência e tenant inexistente). Migração aplicada somente em
`tactia_test`; regressão web 34/34 nos seis arquivos da seção de verificação.
Typecheck de database/domain/web/admin e lint dos arquivos alterados passaram.

O Ops agora tem a aba `/tenants/[id]/preparation` para preparar objetivo,
plano e medição sem recomendação do pipeline. A API valida operador, empresa,
objetivo, fonte ativa, escopo e janela. A publicação ativa objetivo e plano na
mesma transação, mantém a versão inicial e congela a ação `create_task` no
escopo; o cliente decide sua execução no web, pelo executor existente. O valor
inicial pode ser `null`. A fonte escolhida é uma **referência prevista de
cobertura**, não um filtro exclusivo da métrica; essa limitação acompanha a
atribuição e o resultado exibido ao cliente.

Evidência: `settings-routes.test.ts` (21/21, incluindo preparação sem
recomendação/execução, ação imutável, fonte e objetivo de outra empresa,
operador obrigatório, indicador e janela inválidos), `tenant-tabs.test.ts`
(6/6). Typecheck de database/domain/web/admin, lint de admin e do componente
web alterado, e build de admin passaram. O build emite avisos do cliente Prisma
gerado sobre CommonJS e acesso dinâmico ao filesystem. Nenhuma migração
adicional foi necessária.

### Revisão guiada e eventos

`/results` apresenta baseline, observado, janela, fontes e limitações antes de
oferecer continuar, solicitar ajuste ou encerrar. A decisão exige a versão atual
e a revisão mais recente, grava snapshot imutável e incrementa a versão do plano.
Continuar agenda nova revisão; ajuste pausa o plano e abre trabalho no Ops;
encerrar fecha o plano. Resultado medido, objetivo e efeitos externos permanecem
em seus eixos próprios. Aprovações pendentes bloqueiam a decisão.

Cinco eventos são gravados em `command_center_events`: `plan_created`,
`decision_resolved`, `execution_state_changed`, `clarification_requested` e
`clarification_received`. A chave única por empresa deduplica reprocessamentos.
Metadados contêm apenas IDs, estados, versão e clareza da resposta; pergunta,
resposta, telefone e nomes não entram no evento.

Evidência em `tactia_test`: `plan-review-decision.test.ts` (2/2, incluindo
versão obsoleta, revisão obsoleta, isolamento e snapshot), `command-center-cycle.test.ts`
(4/4, eventos de decisão/execução), `clarification-flow.test.ts` (7/7, eventos
sem texto e sem duplicação). Regressão web 34/34, Ops 20/20 e domínio 16/16;
typecheck dos quatro pacotes e lint dos pacotes limpos/arquivos web alterados.

### Acessibilidade — revisão estática parcial

Os cinco gráficos do dashboard já tinham tabela apenas para leitor de tela;
agora oferecem o controle nativo **“Ver dados em tabela”**, acessível por
teclado, com cabeçalhos e linhas semânticas. Os cards da Central quebram o
cabeçalho e mostram valores de objetivo/resultado em uma coluna em larguras
menores que 480px, evitando compressão de números. O editor Ops anuncia estados
assíncronos, associa dicas a campos e leva o foco ao erro de envio.

Uma checagem numérica dos pares de tokens usados em texto/ações corrigiu
contrastes insuficientes: link web claro 4,86:1; botão web claro 5,37:1; link
Ops claro 5,13:1; botão Ops claro (branco no primário) acima de 4,5:1. Textos
de status sobre seus fundos suaves ficaram acima de 5:1 nos pares avaliados.
Regressão após as alterações: web 34/34, Ops 27/27, typecheck dos dois apps,
lint de Ops/arquivos web alterados e builds de produção dos dois apps passaram.
Os builds mantêm avisos do Prisma gerado sobre CommonJS e acesso dinâmico ao
filesystem.

**Limite da evidência:** não havia navegador disponível para esta sessão
(`cua.getState()` sem browsers; `createBrowserTab('iab')` retornou “Browser is
not available”). Portanto, não houve inspeção renderizada em 360/768/1280px,
zoom, leitor de tela, nem validação visual dos dois temas. Não declarar WCAG
2.2 AA concluída até executar essas verificações.

| Rota | Papel |
|---|---|
| `/today` | Síntese, objetivo, até 3 prioridades, trabalho delegado |
| `/objectives`, `/objectives/[id]` | Objetivos preparados, planos e evidências |
| `/operations`, `/operations/plans/[id]` | Decisões versionadas, execução, evidência e resultado |
| `/results` | Revisões com baseline, janela, atribuição e limitação |
| Ops `/gaps` | Fila de lacunas com estado do esclarecimento e ação de consulta |

APIs novas: `/api/v1/objectives`, `/api/v1/plans`, `/api/v1/plans/[id]`,
`/api/v1/plans/[id]/steps/[stepId]/execute`, `/api/v1/measurement-reviews`,
`/api/v1/recommendations/[id]/prepare-plan`, `/api/v1/clarifications/dispatch`,
Ops `/api/v1/evidence-gaps` e `/api/v1/evidence-gaps/[id]/clarification`.

## Decisões que devem ser preservadas

1. **`packages/execution` é a única fonte de execução e aprovação.** O ciclo apenas
   vincula planos a `ActionExecution`/`Approval`. Não criar executor paralelo.
2. **`recommendations/:id/accept` não foi alterado.** Outros clientes dependem da
   semântica atual; o plano apenas referencia `recommendationId`.
3. **Ops prepara, web envia.** O adapter Evolution e a fila vivem em `apps/web`;
   o backoffice nunca envia mensagem diretamente.
4. **`null` nunca vira zero.** `decimalToNumber` legado converte `null` em `0`; por
   isso os DTOs da central usam `nullableDecimalToNumber`. Não reintroduzir o helper
   legado em superfícies de confiança.
5. **Ação executada = ação preparada.** A validação estrutural contra o snapshot
   acontece antes do executor e novamente no vínculo.
6. **Silêncio não confirma nada.** A distinção clara/ambígua é heurística
   determinística, não LLM, para não transformar hesitação em confirmação.

## Riscos e pendências conhecidas

| Item | Severidade | Situação |
|---|---|---|
| Migrações aplicadas **somente** em `tactia_test` | Alta | Desenvolvimento e produção exigem deploy controlado |
| Fallback por env (`COMMAND_CENTER_TENANT_IDS`) | Baixa | Permanece apenas para empresas sem decisão registrada, para desenvolvimento; Ops grava decisão explícita |
| Lint global de `apps/web` falha | Baixa | **Preexistente** em `components/landing/hero-prompt.tsx` e `web-threads.tsx`; comprovado com `git stash` no HEAD |
| 6 testes `browser-integration`/Torge falham | Baixa | **Preexistentes**, validação de URL `app.torge.com.br`; comprovado no HEAD |
| Consolidação/consulta dos eventos analíticos | Baixa | Eventos persistidos; painel de leitura e métricas agregadas ainda não existem |
| Validação visual 360/768/1280, leitor de tela, Web Vitals | Média | Revisão estática e contraste de tokens feitos; navegador indisponível nesta sessão |
| Agrupar lacunas numa mensagem e reenvio após silêncio | Baixa | Fora do escopo atual por decisão |

## Próximos passos sugeridos, em ordem

1. **Concluir validação visual e de acessibilidade** nos três breakpoints e nos
   dois temas, inclusive zoom/leitor de tela; as tabelas equivalentes já estão
   disponíveis nos gráficos.
2. **Consolidar métricas de eventos** para observar o piloto sem mensagem nem PII.
3. **Deploy das migrações** fora de `tactia_test` e piloto com uma empresa real.

## Definition of Done do primeiro recorte

Ainda **não** atingida de ponta a ponta com dados reais. O ciclo está provado em
teste de integração com Postgres real, mas falta: empresa real conectada, deploy
das migrações e observação do resultado comercial em janela real. A validação
visual do item 1 e o deploy/piloto do item 3 ainda faltam.
