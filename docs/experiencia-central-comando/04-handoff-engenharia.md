# Central de comando — handoff para engenharia

> **Estado atual da implementação: `05-status-implementacao.md`.** Entregas 1, 2, 3
> e o Fluxo D já estão implementados e verificados; os critérios abaixo refletem
> isso. Leia o status antes de planejar trabalho novo.

Este documento fecha o pacote de design-spec. Não autoriza implementação nesta etapa e não contém código de UI.

## Implementation Target

- **Agent:** `nextjs-senior-engineer`.
- **Por quê:** os dois apps usam Next.js App Router; o shell e as leituras são Server Components; a experiência exige autorização e composição no servidor, handlers/API, URL state, streaming/chat e isolamento por tenant.
- **Pré-condição de implementação:** ler `apps/web/AGENTS.md`, `apps/admin/AGENTS.md` e os guias relevantes em `node_modules/next/dist/docs/` a partir de cada app. Não presumir APIs do Next por conhecimento prévio.
- **Princípio técnico:** leitura no servidor; interatividade localizada; mutações e validação no servidor; lógica de negócio fora dos componentes.

## Pacote de entrada

1. `00-contexto-e-arquitetura.md` — usuários, premissa de esforço zero, IA e princípios.
2. `01-fluxos-e-estados.md` — quatro fluxos, decisões, erros, persistência e acessibilidade.
3. `02-especificacoes-de-componentes.md` — oito contratos de componentes.
4. `03-design-tokens-warm-command.md` — tokens e comportamento sistêmico.
5. `docs/plano-experiencia-central-de-comando.md` — estratégia, modelagem e sequência de produto.

Em conflito, prevalecem segurança/tenant, capacidade real do backend, ausência de reporte obrigatório e transparência de evidência. Divergências de interface devem voltar ao design/produto, não ser preenchidas por suposição.

## Rotas e composição

| Rota proposta | Composição principal | Estado de migração |
|---|---|---|
| `/today` | ExecutiveSummary, ObjectiveProgress, PriorityCard × até 3, ExecutionTimeline resumida, resultados recentes | Flag por empresa no Ops (`settings-routes.test.ts`, `command-center-flag.test.ts`); `/dashboard` continua |
| `/objectives` | Lista de objetivos preparados + disponibilidade | Nova, sem wizard de cadastro obrigatório |
| `/objectives/[id]` | ObjectiveProgress, planos, evidências e revisões | Link persistente/autorizado |
| `/operations?tab=decisions|in-progress|routines|history` | DecisionCard, ExecutionTimeline e histórico | `/approvals` redireciona/preserva filtros quando maduro |
| `/operations/plans/[id]` | composição de plano, não formulário de tarefas | URL persistente |
| `/results` | OutcomeReview, análises e briefings históricos | Preservar filtros/links de dashboard e briefings |
| `/chat/[id]` | ChatPanel + referência contextual persistida | Nunca invalidar links atuais |
| Admin: rota a fechar | EvidenceGapQueue | Seguir IA operacional existente do admin |

Desktop: conversa contextual em painel sob demanda, com opção de conversa completa. Celular: tela dedicada e retorno ao objetivo/plano/decisão. Nenhuma ação essencial depende de formular prompt.

## Contratos de apresentação obrigatórios

### Envelope de métrica

```typescript
interface MetricEnvelope {
  key: string;
  definition: string;
  value: number | null;
  unit: string;
  period: { from: string; to: string };
  comparison?: { value: number | null; period: { from: string; to: string } };
  availability: 'ready' | 'empty' | 'partial' | 'stale' | 'error';
  references: Array<{ id: string; source: string; href?: string }>;
  eventAt?: string;
  ingestedAt?: string;
  calculatedAt?: string;
  coverage?: string;
  limitation?: string;
}
```

Regras: `value=null` para indisponível; zero somente em `ready`/cobertura válida; atualização de cálculo não altera artificialmente a data da fonte; formatação ocorre por unidade conhecida.

### Referência contextual do chat

```typescript
interface ConversationContextRef {
  tenantId: string;
  type: 'objective' | 'plan' | 'decision' | 'review' | 'evidence';
  resourceId: string;
  version?: number;
  label: string;
}
```

Persistir no servidor e resolver novamente sob tenant/permissão a cada uso. O texto de `?q=` pode prepopular uma pergunta, mas não substitui o vínculo.

### Preview de decisão

Inclui ID/versão, objetivo, motivo, ação formatada por tipo, registros/pessoas afetados, responsável, canal/momento, custo/limite, regime, capacidades reais, resultado esperado e snapshot/referências. No comando, servidor revalida tudo e usa idempotency key.

### Eixos de estado independentes

- Plano: rascunho, ativo, pausado, concluído/encerrado etc.
- Decisão: pendente, aprovada, recusada, alterada/expirada.
- Execução: fila, executando, parcial, bloqueada, falhou, concluída, cancelada.
- Medição: em medição, medida, não mensurável, revisão necessária.

Nenhuma transição em um eixo deve marcar automaticamente sucesso em outro.

## Responsabilidades por pacote

| Superfície | Responsabilidade |
|---|---|
| `apps/web` | shell/IA, páginas RSC, modelos de apresentação, interações localizadas e conversa contextual |
| `apps/admin` | preparação, fontes, mapeamento, política de contato, EvidenceGapQueue e reconciliação |
| `packages/domain` | objetivos, planos, versões, medição, autorização e composição de leitura |
| `packages/intelligence` | métricas/evidências/ranking + relação com objetivo e justificativa |
| `packages/execution` | única fonte de execução/aprovação e vínculos com plano; nunca duplicar executor no frontend |
| `packages/connectors` | ingestão e cobertura observável por fonte |
| `packages/chat` | ChatPanel/protocolo + referência contextual autorizada |
| `packages/database` | migrações aditivas, snapshots históricos, vínculos, lacunas e tentativas |

## Modelo mínimo para fechar antes da UI

1. Extensão aditiva de Goal para título de negócio, responsável, baseline/referência e versão quando necessário.
2. Plano versionado vinculado a Goal e opcionalmente insight/recomendação.
3. Passos de plano vinculáveis a uma ou várias execuções reais, sem quadro manual do cliente.
4. Definição e revisão de medição com indicador, unidade, coorte, janela, baseline, observado, fontes e atribuição.
5. Snapshot de evidência usado na decisão; métrica atualizável não basta para auditoria histórica.
6. Evidência operacional `observed|reported|inferred`, origem, evento, ingestão, validade e vínculo.
7. Lacuna/tentativas/contato/resolução com deduplicação e responsável Ops.

Antes de implementar pergunta proativa, validar que o canal suporta envio, correlação de resposta, identidade, autorização e cancelamento; receber mensagens hoje não prova essa capacidade.

## Sequência recomendada

### Entrega 0 — validação
Protótipo com 5–8 empresários; resultado piloto, fontes, canais e capacidade Ops definidos. Simular empresa que não reporta nada.

### Entrega 1 — semântica de confiança
Corrigir indisponível ≠ zero, regimes reais de autorização e preview/output legível. Não alterar silenciosamente a semântica de `recommendations/:id/accept`.

### Entrega 2 — shell/Hoje/Ops
Feature flag por empresa (`tenants.command_center_enabled`, Ops e testes de release);
novo shell com quatro destinos; Hoje e objetivos preparados; EvidenceGapQueue;
rotas antigas funcionais.

### Entrega 3 — ciclo completo
Plano → versão/decisão → execução idempotente → observação automática/relato identificado → medição/revisão.

### Entregas 4–5
Operação consolidada, revisão semanal, conversa contextual, piloto ampliado e liberação gradual. A decisão guiada de revisão está implementada (`plan-review-decision.test.ts`); a consolidação semanal permanece pendente. Rollback da UI preserva dados/auditoria/execuções e nunca tenta “reverter” efeito externo.

## Critérios de aceite funcionais

Estado em 29/09/2026. Evidência reproduzível em `05-status-implementacao.md`.

- [x] Usuário encontra objetivo, até três prioridades, decisão e acompanhamento sem sintetizar várias telas. — `/today` implementada
- [x] Nenhuma tela crítica apresenta falha/null como zero válido. — `command-center-cycle.test.ts`: `distinguishes a true zero from unavailable data once coverage exists`
- [ ] Todo número decisivo tem definição, unidade, período, fonte, ingestão, cálculo e limitação. — parcial: definição/unidade/janela/limitação prontas; ingestão e cálculo por métrica ainda não vêm de um envelope único
- [x] Fato, relato, inferência, estimativa e sugestão são distinguíveis por texto. — `EvidencePanel` com rótulo por `kind`
- [x] Cliente não cadastra tarefas, atualiza status, faz check-in ou redigita relato. — `command-center-cycle.test.ts`: `completes the transaction without a manual status update`
- [x] Ops recebe lacunas técnicas com impacto, responsável e próximo passo. — Ops `/gaps`
- [x] Pergunta pontual só ocorre após consulta/reconsulta de fontes e dentro da política; silêncio nunca confirma. — `clarification-flow.test.ts` (7 casos)
- [x] Aprovação é ligada à versão, tenant, permissão e capacidade; duplo clique/timeout não duplicam efeito. — `blocks approval after the plan version changes` + idempotency key
- [x] Estado mostrado após comando é o estado efetivo (`approved`, `queued`, `running` etc.), não sucesso presumido. — reconciliação inline nas rotas de decisão
- [x] Concluir execução não marca objetivo atingido; causalidade só aparece com método válido. — eixos separados e `attribution` explícita em `OutcomeReview`
- [x] Pausar/cancelar/desfazer aparecem apenas quando suportados. — `ExecutionTimeline` usa `capabilities`
- [x] Acompanhamento e revisão continuam sem login ou página aberta. — reconciliação no worker + medição no job diário
- [x] Revisão de resultado permite continuar, solicitar ajuste ou encerrar com versão e histórico, sem declarar impacto causal. — `plan-review-decision.test.ts` (2 casos)
- [x] Eventos de plano, decisão, execução e esclarecimento são deduplicados e não guardam mensagem/PII. — `command-center-cycle.test.ts`, `clarification-flow.test.ts`, `plan-review-decision.test.ts`

## Critérios de aceite de UX e acessibilidade

Os itens que dependem de navegador real seguem **pendentes**: nenhuma inspeção
visual foi executada.

- [ ] Teste em 360, 768 e 1280px nos temas claro/escuro. — pendente (exige navegador)
- [x] Ações decisórias e informações de autorização permanecem visíveis em todos os tamanhos. — sem truncamento nos componentes de decisão
- [x] Teclado completo: Tab, Enter/Espaço, Escape, foco inicial/retorno em Dialog/Sheet. — primitivos Base UI existentes
- [x] Foco visível e não encoberto; skip link preservado; zoom não perde conteúdo/ação. — `:focus-visible` global e skip link do shell mantidos
- [x] Estados, severidade, tendência e evidência não dependem apenas de cor. — `Badge` sempre com texto
- [x] Atualizações assíncronas têm anúncio resumido; streaming não narra token a token. — `aria-busy` e `Alert` com `role`
- [ ] Gráficos possuem tabela acessível equivalente. — pendente nas novas superfícies
- [x] Conteúdo de decisão, destinatários, condições e limites não é truncado silenciosamente. — `DecisionCard` expande o payload formatado
- [x] Loading mantém dimensão; erro preserva conteúdo; disabled explica impedimento. — `loading.tsx` e `error.tsx` do grupo `(app)`
- [ ] WCAG 2.2 AA e contrastes são verificados nas combinações finais. — pendente (exige ferramenta de contraste)

## Critérios de teste de engenharia

### Integração
- Indisponível versus zero; partial/stale e timestamps.
- Isolamento tenant e papéis, inclusive links diretos e contexto do chat.
- Versão de decisão, idempotência, concorrência e timeout com reconciliação.
- Eventos atrasados, conflito de fontes e snapshot histórico.
- Deduplicação de lacunas/perguntas, orçamento de contato e cancelamento após dado novo.

### E2E
- Primeiro acesso até plano sem formulário técnico.
- Plano revisado → aprovação → execução → revisão → refresh/retomada.
- Falha parcial, canal indisponível, sessão expirada, offline e troca de empresa.
- Empresa sem reporte: ingestão atualiza andamento; lacuna chega ao Ops; resposta de canal vira relato vinculado sem redigitação.
- Sem resposta: permanece desconhecido; etapas independentes continuam.
- Migração: dashboard, approvals, briefings, chat, agendamentos e links antigos continuam válidos.

### Validação de build e qualidade
Após implementação: lint, typecheck, testes relevantes e build dos pacotes afetados. Medir p75 separado por móvel/desktop: LCP ≤2,5s, INP ≤200ms, CLS ≤0,1. Conteúdo determinístico útil renderiza sem aguardar geração de IA.

## Pesquisa e métricas

No protótipo, pedir ao participante: encontrar prioridade, explicar fonte, dizer o que acontecerá ao aprovar e localizar acompanhamento. Incluir falta de dados, falha de execução e celular.

Metas iniciais a calibrar: ≥80% encontram prioridade/próximo passo em 60s; ≥80% concluem sem ajuda; ninguém interpreta aprovação como garantia de crescimento.

Instrumentar sem conteúdo de mensagens/PII: tempo até primeiro valor, ciclos acompanhados, clareza da delegação, confiabilidade operacional, coleta sem intervenção, esforço obrigatório do cliente (alvo zero), carga de interrupções, resolução Ops e continuidade sem acesso.

## Estratégia de release

- Feature flags independentes para shell/Hoje e ciclo de planos.
- Não exibir controles para etapas ainda indisponíveis.
- Migrações aditivas; APIs e links externos preservados.
- Comparar composição nova com services atuais usando dados reais em piloto controlado.
- Rollback de interface não remove planos, decisões, auditoria ou execuções.
- Refatoração visual nunca amplia permissões ou autonomia.

## Definition of Done do primeiro recorte

Um caso real de recuperação de clientes inativos percorre objetivo → evidência → plano → decisão necessária → execução no processo existente → coleta por fonte ou relato identificado → revisão, sem qualquer atualização manual de status na Tactia pelo cliente. Lacunas ficam no Ops; ausência de resposta permanece desconhecida; resultado comercial é apresentado como observado e limitado, não como impacto causal presumido.
