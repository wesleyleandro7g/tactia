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

Os testes de integração exigem o banco de teste, que já tem as 4 migrações novas
aplicadas. Nunca aponte estes comandos para o banco de desenvolvimento.

```bash
export TEST_DB=postgresql://tactia:tactia@localhost:5433/tactia_test

# migrações (idempotente)
DATABASE_URL=$TEST_DB pnpm db:migrate:deploy

# ciclo plano → decisão → execução → evidência → medição
cd apps/web && DATABASE_URL=$TEST_DB pnpm exec vitest run \
  src/__tests__/command-center-cycle.test.ts \
  src/__tests__/command-center-flow.test.ts

# esclarecimento pontual por WhatsApp
cd apps/web && DATABASE_URL=$TEST_DB pnpm exec vitest run \
  src/lib/__tests__/clarification-flow.test.ts

# unitários de domínio
cd packages/domain && pnpm exec vitest run \
  src/__tests__/command-center-service.test.ts \
  src/__tests__/evidence-clarification-policy.test.ts

# regressão do fluxo anterior (não deve quebrar)
cd apps/web && DATABASE_URL=$TEST_DB pnpm exec vitest run src/__tests__/pilot-flow.test.ts
```

## Estado por entrega

Referência: a sequência definida em `04-handoff-engenharia.md`.

| Entrega | Estado | Observação |
|---|---|---|
| 0 — validação com empresários | **Não iniciada** | Exige acesso a participantes; nada de código depende disso |
| 1 — semântica de confiança | **Feito** | `MetricEnvelope`-like por bloco, indisponível ≠ zero, regime de autorização real |
| 2 — shell/Hoje/Objetivos/Ops | **Feito** | 6 rotas novas + fila de lacunas; rotas antigas preservadas |
| 3 — ciclo completo | **Feito** | Recomendação → plano versionado → decisão → execução → evidência → medição |
| 4 — operação consolidada | **Parcial** | Conversa contextual e revisão automática prontas; revisão semanal e ajuste/encerramento guiado pendentes |
| 5 — piloto ampliado | **Não iniciada** | Depende de deploy e de empresa real |
| Fluxo D — esclarecimento | **Feito** | Política opt-in, orçamento, correlação e registro automático |

## O que está implementado e verificado

### Modelagem (4 migrações aditivas)

| Migração | Conteúdo |
|---|---|
| `20260928230000_command_center_slice` | `Goal` estendido; `Plan`, `PlanStep`, `PlanStepExecution`, `MeasurementDefinition`, `MeasurementReview`, `OperationalEvidence`, `EvidenceGap` |
| `20260928235000_command_center_cycle` | `planVersion` + `decisionSnapshot` no vínculo; uniques de idempotência (execução, evidência por `externalRef`, plano por recomendação) |
| `20260929002500_conversation_context` | `conversations.context_ref` para conversa contextual persistente |
| `20260929102000_evidence_clarifications` | Política de contato em `whatsapp_agent_configs` + tabela `evidence_clarifications` |

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
| Feature flag por env (`COMMAND_CENTER_TENANT_IDS`) | Média | Handoff prevê flag por empresa administrável pelo Ops |
| Lint global de `apps/web` falha | Baixa | **Preexistente** em `components/landing/hero-prompt.tsx` e `web-threads.tsx`; comprovado com `git stash` no HEAD |
| 6 testes `browser-integration`/Torge falham | Baixa | **Preexistentes**, validação de URL `app.torge.com.br`; comprovado no HEAD |
| Eventos analíticos do handoff | Média | Não instrumentados |
| Validação visual 360/768/1280, leitor de tela, Web Vitals | Média | Não executada; exige navegador real |
| Editor de planos/medição no Ops | Média | Preparação ainda depende de recomendação existente |
| Agrupar lacunas numa mensagem e reenvio após silêncio | Baixa | Fora do escopo atual por decisão |

## Próximos passos sugeridos, em ordem

1. **Flag por empresa administrável** no Ops, substituindo a variável de ambiente,
   já que a estratégia de release do handoff depende disso.
2. **Revisão de resultado guiada**: ajustar, continuar ou encerrar plano a partir de
   `/results`, versionando a decisão (hoje a revisão é lida, não decidida).
3. **Instrumentação de eventos** (`plan_created`, `decision_resolved`,
   `execution_state_changed`, `clarification_requested`, `clarification_received`),
   sem payload de mensagem nem PII.
4. **Editor de preparação no Ops**, para criar objetivo/plano/medição sem depender
   de uma recomendação gerada pelo pipeline.
5. **Validação visual e de acessibilidade** nos três breakpoints e nos dois temas,
   com tabela equivalente nos gráficos.
6. **Deploy das migrações** fora de `tactia_test` e piloto com uma empresa real.

## Definition of Done do primeiro recorte

Ainda **não** atingida de ponta a ponta com dados reais. O ciclo está provado em
teste de integração com Postgres real, mas falta: empresa real conectada, deploy
das migrações e observação do resultado comercial em janela real. Os itens 1, 2 e
6 acima são o caminho mais curto até lá.
