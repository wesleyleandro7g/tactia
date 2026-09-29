# Central de comando — fluxos e estados

Estrutura baseada em `references/user-flow-template.md`. Contratos são especificações de dados e comportamento, não código de UI.

## Flow: Primeiro valor com acompanhamento

### Overview

**Goal:** chegar ao primeiro diagnóstico útil e iniciar um plano sem exigir configuração ou reporte do cliente.

**User Story:** Como empresário, quero saber o que a Tactia fará, o que falta e quem realizará cada próximo passo para começar com segurança.

**Trigger:** primeiro acesso liberado ou abertura do card de preparação.

### Entry Points
- [x] `/onboarding` — acesso real ainda em preparação.
- [x] `/today?view=preparation` — empresa liberada, primeiro valor incompleto.
- [x] Link de acompanhamento enviado pelo Ops — retorno autenticado para a mesma empresa.

### Prerequisites
- [x] Sessão válida e empresa autorizada no servidor.
- [x] Acesso liberado pelo Ops para dados reais.
- [x] Contexto de consultoria/fontes recuperado antes de perguntar ao usuário.

### Flow Diagram

```text
[Primeiro acesso]
  → [Recuperar intenção e fontes]
  → ◇ Intenção suficiente?
      ├─ não → [Pergunta pontual por conversa]
      └─ sim
  → [Ops prepara e valida dados]
  → ◇ Cobertura suficiente?
      ├─ parcial → [Diagnóstico limitado + lacuna Ops]
      └─ sim → [Diagnóstico + objetivo preparado]
  → ◇ Decisão de autoridade necessária?
      ├─ sim → [Revisar decisão]
      └─ não
  → [Primeiro plano acompanhado]
```

### Steps

#### Step 1: Confirmar foco
**Screen/Component:** preparação em Hoje + conversa contextual.

**User Action:** confirmar intenção somente se ela não puder ser inferida; ajustar por conversa, opcionalmente.

**System Response:** recupera consultoria, metas e fontes; mostra objetivo preparado, origem do contexto e pergunta única apenas sobre a lacuna.

**Data:** Input: confirmação/ajuste opcional. Output: objetivo em rascunho, referências e campos ainda desconhecidos.

**Transitions:** contexto suficiente → passo 2; falta de autoridade → acesso restrito; ausência de resposta → rascunho preservado e Ops responsável.

#### Step 2: Preparar fontes
**Screen/Component:** status de preparação.

**User Action:** nenhuma ação operacional; autenticar/consentir somente se o provedor exigir o titular.

**System Response:** Ops configura acesso, mapeamento e validação; status textual identifica responsável e próximo evento conhecido. Não exibe percentuais ou prazo inventados.

**Transitions:** fonte válida → passo 3; parcial → passo 3 limitado; falha → lacuna no Ops; consentimento inevitável → etapa mínima preparada.

#### Step 3: Apresentar diagnóstico
**Screen/Component:** `ExecutiveSummary`, `ObjectiveProgress`, `EvidencePanel`.

**User Action:** consultar; apontar divergência opcionalmente.

**System Response:** apresenta baseline, meta sugerida, cobertura, fontes e limitações. Divergência cria revisão no Ops sem apagar o valor anterior.

**Transitions:** dados válidos → passo 4; divergência → permanece consultável com “em revisão”; indisponível → preparação pendente.

#### Step 4: Iniciar primeiro plano
**Screen/Component:** detalhe do objetivo/plano + `DecisionCard` quando necessário.

**User Action:** decidir apenas objetivo, compromisso, condição ou limite sob sua autoridade.

**System Response:** plano versionado já contém responsáveis do processo existente, indicador, fonte de acompanhamento e próxima revisão; iniciar não exige cadastrar tarefas.

**Transitions:** decisão válida → plano ativo; ajuste solicitado → nova versão; fechar → rascunho salvo.

### Decision Points

#### Decision: Cobertura suficiente
**Condition:** contrato de disponibilidade por métrica/fonte.
- **Ready:** diagnóstico completo.
- **Partial/stale:** apenas conclusões suportadas, com limitação e impacto.
- **Empty/error:** sem valores substitutos; Ops assume preparação.

#### Decision: Autoridade do usuário
**Condition:** papel e escopo no servidor.
- Autorizado → ação disponível.
- Não autorizado → conteúdo permitido + papel necessário, sem dados sensíveis ou botão inerte.

### Exit Points

- **Success Exit:** primeiro plano iniciado; destino `/objectives/[id]`; feedback “Plano iniciado” + próxima revisão/fonte.
- **Cancel/Abandon Exit:** fechar ou navegar; rascunho e etapa ficam no servidor; retorno à origem.
- **Error Exit:** preparação indisponível; mostra o que foi preservado, responsável real e canal existente. Retry só quando acionável.

### Error Handling

| Error Type | User Message | Recovery |
|---|---|---|
| Fonte parcial | “Diagnóstico parcial com dados até [data].” | Ver evidência; Ops reconcilia |
| Consentimento expirado | “Precisamos renovar este acesso para continuar esta medição.” | Ação mínima do titular |
| Falha de ingestão | “A atualização desta fonte não foi concluída.” | Último dado válido + tratamento Ops |
| Permission | “Seu papel não permite confirmar este objetivo.” | Informar papel; voltar a Hoje |
| Session | “Sua sessão expirou.” | Login com `returnTo` e rascunho preservado |

### Edge Cases

| Scenario | Handling |
|---|---|
| Refresh/fechar navegador | Restaurar empresa, etapa e rascunho do servidor |
| Informação já dada na consultoria | Não perguntar novamente; mostrar referência |
| Sem prazo operacional conhecido | Dizer “prazo ainda não disponível”; não inventar previsão |
| Troca de empresa | Limpar contexto e revalidar link; nunca transportar rascunho |
| Nenhuma resposta a pergunta | Manter desconhecido; Ops segue responsável |

### State Requirements

**URL State:** `view=preparation`, `objectiveId`, `returnTo`; não transportar dados sensíveis no query string.

**Local State:** foco, painel de evidência aberto e texto de ajuste opcional não enviado.

**Persisted State:** etapa, objetivo/versionamento, referências, consentimentos, lacunas e responsável Ops.

### Analytics Events

| Event | Trigger | Properties sem PII |
|---|---|---|
| `activation_started` | entrada | source, tenantId, preparationState |
| `objective_drafted` | objetivo persistido | objectiveId, sourceTypes |
| `first_diagnosis_viewed` | síntese visível | availability, coverageBand |
| `first_plan_started` | plano ativo | planId, authorizationRegime |

### Accessibility Considerations
- Foco entra no `h1`; ao trocar etapa, vai ao heading da etapa.
- Atualizações de preparação usam `aria-live="polite"` somente para mudança resumida.
- Limitação aparece em texto e não só por cor.
- Consentimento abre diálogo com foco contido; fechar devolve ao acionador.

### Implementation Target
- **Agent:** `nextjs-senior-engineer`.
- **Components needed:** ExecutiveSummary, ObjectiveProgress, EvidencePanel, DecisionCard.
- **API/contracts:** objetivos, disponibilidade, preparação Ops e consentimento real; endpoints finais fechados após modelagem.

### Acceptance Criteria
- [ ] Primeiro valor pode ocorrer sem formulário técnico ou reporte.
- [ ] Informação existente nunca é perguntada novamente.
- [ ] Estados ready/partial/empty/error não se confundem com zero.
- [ ] Refresh, sessão expirada e troca de empresa preservam isolamento e retorno.
- [ ] Em 360/768/1280px, próximo passo, responsável e limitação permanecem legíveis.

---

## Flow: Entender, decidir e delegar

### Overview
**Goal:** transformar uma prioridade em execução acompanhada e verificável.

**User Story:** Como empresário, quero entender uma proposta e delegar sabendo alcance, responsável, autorização e efeito esperado.

**Trigger:** abrir prioridade em Hoje/Objetivo/Operação ou referência contextual na conversa.

### Entry Points
- [x] `PriorityCard` em `/today`.
- [x] `/objectives/[id]` e `/operations/plans/[id]`.
- [x] `/chat/[id]` com referência estruturada.
- [x] `/operations?tab=decisions&decisionId=...` (migração de `/approvals`).

### Prerequisites
- [x] Tenant e permissão revalidados no servidor.
- [x] Evidência e versão persistidas.
- [x] Capacidade de executar/cancelar conhecida, sem promessa visual fictícia.

### Flow Diagram

```text
[Prioridade] → [Evidência] → [Plano vN] → [Revisão de alcance]
  → ◇ Regime de autorização?
      ├─ revisão por ação → [Decisão autorizada]
      ├─ pedido direto/rotina válida → [Identificar escopo válido]
      └─ capacidade ausente → [Bloqueio + Ops]
  → [Estado efetivo: aprovada/na fila/executando/...]
  → [Acompanhamento automático] → [Medição]
```

### Steps

#### Step 1: Entender
**Screen/Component:** `PriorityCard` + `EvidencePanel`.

**User Action:** abrir evidência; seguir para plano ou dispensar com motivo opcional.

**System Response:** mostra motivo da ordem, objetivo, fato/estimativa/sugestão, período, fonte, cobertura e limitações.

**Transitions:** seguir → passo 2; dispensar → prioridade removida após confirmação do servidor; evidência insuficiente → Ops + ações dependentes bloqueadas.

#### Step 2: Planejar
**Screen/Component:** composição de detalhe do plano (não um formulário de tarefas).

**User Action:** revisar; solicitar ajuste por conversa, opcionalmente.

**System Response:** plano pronto com escopo, registros/pessoas afetados, responsável, prazo quando sustentado, indicador e fonte. Cada ajuste cria versão; nenhum rascunho executa.

**Transitions:** versão revisável → passo 3; capacidade ausente → bloqueio; fechar → rascunho persistido.

#### Step 3: Decidir
**Screen/Component:** `DecisionCard`.

**User Action:** aprovar ação específica, solicitar ajuste ou recusar; justificativa opcional.

**System Response:** servidor revalida tenant, permissão, capacidade, payload e versão; retorna estado real. Conteúdo sensível fica visível, não em tooltip.

**Validation contract:** responsável autorizado; payload válido; versão aprovada = executada; evidência dentro da política; idempotency key; estimativa não obrigatória sem base.

**Transitions:** aprovada → passo 4; ajuste → nova versão sem aprovação herdada; recusada → saída registrada; timeout → reconciliação antes de retry.

#### Step 4: Delegar
**Screen/Component:** `ExecutionTimeline`.

**User Action:** nenhuma confirmação repetida para o mesmo escopo autorizado.

**System Response:** cria/reutiliza execução idempotente, mostra “Aprovada”, “Na fila” ou estado efetivo; registra vínculo plano/decisão/execução.

**Transitions:** em andamento → passo 5; parcial/bloqueada/falha → exceção real; concluída → medição, não sucesso automático.

#### Step 5: Acompanhar
**Screen/Component:** `ExecutionTimeline` + `OutcomeReview`.

**User Action:** consultar; decidir apenas mudança que exija autoridade.

**System Response:** coleta eventos/ingestão/relatos, mostra proveniência e próxima etapa; acompanhamento continua sem página aberta.

### Decision Points

- **Regime:** revisão por ação, pedido direto registrado ou rotina previamente autorizada; sempre textual e persistido.
- **Versão mudou:** invalida decisão anterior e exige revisão da versão atual.
- **Capacidade ausente:** sem botão de aprovar; Ops recebe bloqueio.
- **Concorrência:** primeira decisão confirmada prevalece; segunda recebe autor, horário e estado atual.

### Exit Points
- **Success:** execução vinculada e acompanhada; destino `/operations/plans/[id]`; feedback com estado real.
- **Cancel/Abandon:** rascunho preservado; nenhuma execução implícita.
- **Error:** conteúdo revisado continua visível; oferece retry/reconciliação somente após consulta de estado.

### Error Handling

| Error Type | User Message | Recovery |
|---|---|---|
| Versão divergente | “O plano mudou desde sua revisão.” | Abrir diff/resumo da versão atual |
| Duplo clique/replay | “Esta decisão já foi registrada por [papel] às [hora].” | Mostrar execução existente |
| Timeout após envio | “Estamos confirmando se a ação foi recebida.” | Consultar por idempotency key; sem novo envio |
| Capacidade ausente | “Este canal ainda não permite executar esta ação.” | Limitação + tratamento Ops |
| Offline | “Comandos indisponíveis sem conexão.” | Manter rascunho; nunca enfileirar aprovação silenciosa |

### Edge Cases

| Scenario | Handling |
|---|---|
| Refresh/back | URL restaura plano/decisão e foco lógico |
| Execução parcial | Itens processados e pendentes separados, com proveniência |
| Cancelamento | Explicar efeitos que já ocorreram; confirmar somente após servidor |
| Link direto sem permissão | Página segura sem conteúdo do tenant |
| Prioridade já em execução | Substituir ação principal por “Acompanhar”; não duplicar |

### State Requirements
**URL State:** `planId`, `decisionId`, `context`, `returnTo`; IDs opacos e autorizados.

**Local State:** painel aberto, foco e ajuste opcional em elaboração.

**Persisted State:** plano/versionamento, snapshot de evidência, decisão, regime, idempotência, execuções e vínculos.

### Analytics Events
`priority_opened`, `evidence_opened`, `plan_created`, `decision_resolved`, `execution_state_changed`; capturar IDs técnicos e estados, nunca corpo de mensagens ou destinatários.

### Accessibility Considerations
- Ação principal é única por card; ordem de Tab acompanha leitura.
- Após decisão, foco vai ao heading do status e anúncio resume estado, não detalhes técnicos.
- Escape fecha detalhes sem decidir; confirmação destrutiva não usa fechamento como aceite.
- Linha do tempo é lista ordenada semântica; ícone/cor têm rótulo textual.

### Implementation Target
- **Agent:** `nextjs-senior-engineer`.
- **Components needed:** PriorityCard, EvidencePanel, DecisionCard, ExecutionTimeline, OutcomeReview, ChatPanel.
- **API/contracts:** planos/versionamento, preview de decisão, aprovações atuais, execuções e contexto persistente.

### Acceptance Criteria
- [ ] Usuário explica alcance, responsável, autorização e próxima etapa antes de aprovar.
- [ ] Versão, concorrência, duplo clique e timeout não duplicam efeitos.
- [ ] Execução e resultado não são confundidos.
- [ ] Acompanhamento independe de login, página aberta ou check-in.
- [ ] Links diretos e troca de empresa revalidam tenant e permissão.

---

## Flow: Revisar o resultado

### Overview
**Goal:** comparar intenção e observado, reconhecer limitações e decidir ajuste, continuidade ou encerramento.

**User Story:** Como empresário, quero saber se a iniciativa contribuiu para o objetivo sem confundir correlação com causalidade.

**Trigger:** revisão acordada, mudança relevante ou visita a `/results`.

### Entry Points
- [x] Resultado recente em Hoje.
- [x] `/results?planId=...&reviewId=...`.
- [x] Plano em Operação.
- [x] Notificação autorizada com link autenticado.

### Prerequisites
- [x] Plano e definição de medição versionados.
- [x] Baseline, janela, unidade e fontes registradas, ou indisponibilidade explícita.

### Flow Diagram

```text
[Coletar fontes] → ◇ Lacuna relevante?
  ├─ sim → [Ops reconcilia/pergunta pontual] → [conhecido ou sem confirmação]
  └─ não
→ [Comparar coortes/períodos compatíveis]
→ ◇ Janela/dados suficientes?
  ├─ não → [Em medição / Não foi possível medir]
  └─ sim → [Separar atividade de resultado]
→ [Síntese + proposta pronta] → [Continuar / Ajustar / Encerrar]
```

### Steps

#### Step 1: Coletar e qualificar
**Screen/Component:** processamento no servidor; status em `OutcomeReview`.

**User Action:** nenhuma.

**System Response:** coleta fontes e registra cobertura, ingestão, cálculo e lacunas; Ops assume reconciliação.

#### Step 2: Comparar
**Screen/Component:** `OutcomeReview` + `EvidencePanel`.

**User Action:** verificar dados, tabela equivalente e limitações.

**System Response:** apresenta objetivo, baseline, alvo, observado, janela e comparação válida. Se suportado, separa contatos, respostas e compras; não atribui compra à Tactia sem método.

#### Step 3: Decidir próximo ciclo
**Screen/Component:** ações da revisão.

**User Action:** continuar, aprovar ajuste preparado ou encerrar; justificativa livre é opcional.

**System Response:** registra decisão e próxima revisão. Alterar meta cria nova versão prospectiva; histórico mantém definição anterior.

### Decision Points
- Janela insuficiente → “Em medição” + data/condição conhecida.
- Sem dados de resultado → “Não foi possível medir” + impacto da lacuna.
- Abaixo do esperado → propor revisão; nunca encerrar automaticamente.
- Causalidade não sustentada → “variação observada”, não “resultado gerado”.

### Exit Points
- **Success:** revisão persistida e próximo estado definido; permanece em Resultados ou volta ao plano.
- **Abandon:** leitura não exige decisão; nenhuma alteração implícita.
- **Error:** último resultado válido permanece com data; falha atual separada.

### Error Handling

| Error Type | User Message | Recovery |
|---|---|---|
| Janela insuficiente | “Ainda não há período suficiente para avaliar.” | Mostrar próxima revisão se conhecida |
| Resultado ausente | “Não foi possível medir [indicador].” | Evidência/lacuna; Ops responsável |
| Fonte conflitante | “As fontes divergem; nenhuma foi sobrescrita.” | Abrir proveniência; Ops reconcilia |
| Definição alterada | “Esta revisão usa a definição vN.” | Comparar apenas períodos compatíveis |

### Edge Cases

| Scenario | Handling |
|---|---|
| Meta muda após execução | Histórico mantém alvo antigo; nova meta vale adiante |
| Planos/coortes sobrepostos | Não somar impacto como independente |
| Evento atrasado | Reconciliar e versionar revisão; indicar atualização |
| Zero verdadeiro | Mostrar zero só com cobertura conhecida |
| Sem visita ao app | Revisão é preparada normalmente e aguarda apenas decisão legítima |

### State Requirements
**URL State:** `planId`, `reviewId`, `period`; filtros compatíveis com links antigos de análise.

**Persisted State:** definição/versionamento, baseline, janela, observado, evidências, limitações, decisão e próxima revisão.

### Analytics Events
`outcome_reviewed`, `plan_adjusted`, `plan_closed`; propriedades: state, availability, decisionType, measurementVersion.

### Accessibility Considerations
- Comparações usam texto e números tabulares; tendência não depende de seta/cor.
- Gráfico, se usado, possui tabela acessível com mesmos dados.
- Alteração de período move foco ao título da região atualizada e anuncia resumo.

### Implementation Target
- **Agent:** `nextjs-senior-engineer`.
- **Components needed:** OutcomeReview, EvidencePanel, ObjectiveProgress.
- **API/contracts:** definição/revisões de medição e envelopes de métricas.

### Acceptance Criteria
- [ ] Baseline, alvo, observado, unidade, janela, fonte e limitação aparecem juntos.
- [ ] Estado cobre medido, em medição e sem medição.
- [ ] Atribuição causal só é usada com método registrado.
- [ ] Histórico não é reescrito por nova meta ou evento atrasado.
- [ ] Fluxo não exige justificativa, reporte ou atualização manual.

---

## Flow: Obter informação sem criar rotina de reporte

### Overview
**Goal:** resolver lacuna com menor interrupção possível e sem transformar o app ou WhatsApp em formulário.

**User Story:** Como colaborador, quero responder apenas quando eu realmente detenho uma informação ausente, no canal habitual, sem repetir o relato em outro lugar.

**Trigger:** ausência, conflito ou envelhecimento de evidência necessária.

### Entry Points
- [x] Monitoramento de plano/execução.
- [x] Ingestão/reconciliação de fonte.
- [x] `EvidenceGapQueue` no Ops.

### Prerequisites
- [x] Tenant/plano, política de consulta e responsável Ops definidos.
- [x] Fontes consultáveis e pessoas/canais autorizados.
- [x] Orçamento de contato, horário e deduplicação ativos.

### Flow Diagram

```text
[Lacuna detectada] → [Consultar todas as fontes autorizadas]
→ ◇ Resolvida?
  ├─ sim → [Vincular evidência observada]
  └─ não → [Correlacionar + classificar lacuna] → [Fila Ops]
      → ◇ Só uma pessoa detém o fato e contato é permitido?
        ├─ não → [Tratar configuração ou manter desconhecido]
        └─ sim → [Reconsultar fonte] → [Pergunta curta no canal]
             → ◇ Resposta clara?
               ├─ sim → [Relato identificado e vinculado]
               └─ não/silêncio → [Sem confirmação + retorno ao Ops]
```

### Steps

#### Step 1: Consultar fontes
**Screen/Component:** automação; registro visível no Ops.

**System Response:** busca CRM, ERP, tarefas, vendas e interações disponíveis; reutiliza dados antes de perguntar.

#### Step 2: Correlacionar e classificar
**System Response:** vincula registro ao plano e classifica `observed`, `reported` ou `inferred`; não infere atividade apenas por resultado posterior.

#### Step 3: Tratar no Ops
**Screen/Component:** `EvidenceGapQueue`.

**User Action (Ops):** reconciliar, corrigir configuração, preparar consulta ou registrar limitação.

**System Response:** deduplica por empresa/assunto/pessoa/contexto, preserva versões e define próximo passo/responsável.

#### Step 4: Perguntar pontualmente
**Screen/Component:** preview no Ops; mensagem no canal habitual.

**User Action (colaborador):** responder pergunta curta, por exemplo “Sobre o contato com a Empresa X: houve retorno?”.

**System Response:** imediatamente antes do envio, reconsulta a fonte; agrupa perguntas relacionadas e respeita limites/horários.

#### Step 5: Registrar resposta
**System Response:** registra automaticamente conteúdo necessário, autoria, canal, referência, horário, plano e tipo de evidência; não solicita redigitação.

#### Step 6: Resolver ou manter desconhecido
**System Response:** resposta clara resolve; ambiguidade/silêncio permanece “sem confirmação”. Etapas independentes continuam; só dependências reais são suspensas.

### Decision Points
- Dado chegou antes do contato → cancelar pergunta pendente.
- Sem política/canal autorizado → não enviar; Ops trata.
- Silêncio → nunca confirmar status, conclusão ou aprovação.
- Resposta de status → nunca autoriza ação de negócio distinta.

### Exit Points
- **Success:** evidência observada ou relato identificado vinculado.
- **Unresolved:** limitação registrada, próxima tentativa permitida ou caso sem resolução.
- **Cancel:** pergunta cancelada por dado novo, política ou Ops; histórico preservado.

### Error Handling

| Error Type | User Message/Ops | Recovery |
|---|---|---|
| Canal indisponível | Ops vê falha e impacto | Não duplicar em outro canal automaticamente |
| Resposta ambígua | “Sem confirmação” | Ops revisa ou pergunta novamente dentro do orçamento |
| Fonte conflitante | Duas proveniências visíveis | Reconciliar; não sobrescrever |
| Identidade incerta | Bloquear vinculação automática | Ops resolve identidade |
| Tenant mismatch | Negar e auditar | Nenhum conteúdo no contexto errado |

### Edge Cases

| Scenario | Handling |
|---|---|
| Mesma pergunta em dois planos | Agrupar/deduplicar quando contexto permitir |
| Dado chega após pergunta | Cancelar lembrete; reconciliar resposta e fonte sem apagar divergência |
| Resposta fora da janela | Registrar horário; avaliar validade conforme política |
| Pessoa sem resposta | Não escalar automaticamente ao dono |
| Muitas lacunas | Priorizar por impacto; limite por pessoa/período |

### State Requirements
**Persisted State:** lacuna, fontes tentadas, pessoa/canal, tentativas, pergunta, referência da resposta, tipo, timestamps, responsável, impacto e próxima tentativa permitida.

**Local State no Ops:** filtros, seleção e rascunho de pergunta; rascunho não autoriza envio.

### Analytics Events
`evidence_gap_detected`, `evidence_resolved_from_source`, `clarification_requested`, `clarification_received`, `ops_gap_resolved`; sem payload da mensagem ou PII desnecessária.

### Accessibility Considerations
- Fila é tabela/lista com headers e status textual; filtros têm labels.
- Preview de contato identifica pessoa, assunto, canal, horário e por que a pergunta é necessária.
- Atualização em lote anuncia contagem e falhas; foco permanece previsível.

### Implementation Target
- **Agent:** `nextjs-senior-engineer`.
- **Components needed:** EvidenceGapQueue no admin; EvidencePanel e ExecutionTimeline no app.
- **API/contracts:** lacunas, tentativas, políticas, correlação de resposta e deduplicação.

### Acceptance Criteria
- [ ] Fontes são consultadas e reconsultadas antes de perguntar.
- [ ] Resposta vira evidência sem redigitação ou login no app.
- [ ] Perguntas são deduplicadas, agrupadas e limitadas.
- [ ] Silêncio, ambiguidade e conflito permanecem explícitos.
- [ ] Nenhuma informação ou pergunta cruza tenants.

---

## Estados transversais

| Estado | Regra de apresentação e recuperação |
|---|---|
| Loading | Skeleton estável por seção; ação longa mostra progresso textual real; conteúdo útil não espera IA |
| Empty | Explica fonte/preparação e responsável; nunca pede reporte ou converte em zero |
| True zero | Valor 0 apenas após consulta válida e cobertura conhecida |
| Partial/stale | Último valor válido + data + impacto; bloquear somente decisão dependente |
| Sem prioridades | “Nenhuma decisão necessária agora” + operação acompanhada + próxima revisão conhecida |
| Failure | Linguagem compreensível, conteúdo preservado, retry real; detalhe técnico só no suporte/Ops |
| Permission | Papel necessário sem revelar dados; servidor continua sendo autoridade |
| Decisão já tomada | Autor/papel, horário e estado; sem novo efeito |
| Plano alterado | Versão atual e resumo da mudança; aprovação anterior inválida |
| Timeout após comando | Reconciliar execução antes de retry |
| Offline | Comandos indisponíveis; rascunho local/persistido conforme segurança; aprovação nunca enfileirada silenciosamente |
| Sessão expirada | Reautenticar com retorno e rascunho autorizado |
| Troca de empresa | Limpar caches/contexto e revalidar IDs; sem rascunho entre tenants |
| Cancelamento | Explicar efeito já ocorrido; confirmar só após servidor |
| Informação faltante | Ops assume; cliente vê apenas limitação relevante |
| Pergunta sem resposta | Sem confirmação; respeitar política; seguir etapas independentes |
| Fontes em conflito | Proveniências lado a lado; reconciliação Ops; sem overwrite silencioso |