# Central de comando — especificações de componentes

Estrutura baseada em `references/component-spec-template.md`. As interfaces abaixo são contratos de handoff, não implementação. Tipos compartilhados sugeridos:

```typescript
type Availability = 'ready' | 'empty' | 'partial' | 'stale' | 'error';
type EvidenceKind = 'observed' | 'reported' | 'inferred';
type AuthorizationRegime = 'per_action' | 'direct_request' | 'preauthorized_routine';
type Reference = { id: string; label: string; href?: string; kind: EvidenceKind };
type TimestampInfo = { eventAt?: string; ingestedAt?: string; calculatedAt?: string };
```

## Component: ExecutiveSummary

### Purpose
Orientar a leitura de Hoje com mudança, relação com objetivo, atenção principal e referências verificáveis, sem bloquear o restante se a narrativa estiver indisponível.

### Variants
- `ready`: síntese sustentada por referências.
- `no-objective`: contexto disponível, sem objetivo em foco.
- `partial`: conclusões limitadas por cobertura.
- `unavailable`: síntese não gerada; demais blocos continuam.

### Props
```typescript
interface ExecutiveSummaryProps {
  objective?: { id: string; title: string } | null;
  period: { from: string; to: string; label: string };
  summary?: string | null;
  attention?: { label: string; priorityId?: string } | null;
  references: Reference[];
  availability: Availability;
  limitation?: string | null;
  updatedAt?: string | null;
  onOpenEvidence?: (referenceId?: string) => void;
  onOpenConversation?: () => void;
}
```

### States
| State | Visual | Behavior |
|---|---|---|
| Default | Título editorial, síntese curta, atenção e metadados | Referências abrem evidência |
| Hover/focus | Somente links/ações elevam contraste; foco visível | Card inteiro não finge ser botão |
| Loading | Linhas skeleton estáveis | `aria-busy`; restante da página independente |
| Partial/stale | Alert textual + data válida | Ação dependente pode ser restringida |
| Error | Mensagem local e conteúdo preservado | Conversa e outros blocos continuam |
| No objective | “Estamos preparando seu foco” se houver processo real | Sem CTA para cadastrar meta |

### Responsive Behavior
| Breakpoint | Behavior |
|---|---|
| 360px | Uma coluna; metadados quebram linha; ações 44px e largura disponível |
| 768px | Síntese e metadados em bloco único; ações lado a lado se couberem |
| 1280px | Ocupa largura principal; até 68 caracteres por linha |

### Accessibility
**ARIA:** seção com heading associado; `aria-describedby` para limitação; live region só na atualização assíncrona resumida.

**Keyboard:** Tab percorre referências e ações; Enter ativa; Escape fecha evidência sem efeito.

**Screen Reader:** anuncia objetivo, período, disponibilidade e atualização; referências têm nomes específicos.

### Animations
Entrada/estado: 120–180ms, opacidade/contraste, sem layout shift; nenhuma animação se `prefers-reduced-motion`.

### Composition
Card + heading + período + síntese + atenção + referências + ações “Ver evidências” e “Conversar sobre isso”.

### Edge Cases
Resumo longo limita-se editorialmente a 2–3 frases, mas não trunca informação decisória; referências vazias em `ready` são erro de contrato; data ausente vira “Atualização não disponível”.

### Dependencies
Card, Alert, Button/link, Badge e EvidencePanel existentes; dados resolvidos no servidor.

### Implementation Notes
**Performance:** renderizar dados determinísticos sem aguardar narrativa de IA. **Testing:** ausência de síntese, parcial, links autorizados, temas, zoom.

### Implementation Target
- **Agent:** `nextjs-senior-engineer`.
- **Framework notes:** Server Component por padrão; cliente apenas para abrir painel/conversa.
- **File location:** `apps/web/src/components/app/command-center/executive-summary.tsx`.

### Acceptance Criteria
- [ ] Restante de Hoje renderiza sem resumo.
- [ ] Fonte, período, atualização e limitação são legíveis.
- [ ] Nenhum estado vazio exige cadastro/reporte.
- [ ] Funciona em 360/768/1280px, teclado, zoom e temas.

---

## Component: ObjectiveProgress

### Purpose
Mostrar direção do objetivo com baseline, realizado, alvo, prazo, ritmo e disponibilidade sem inventar percentual ou projeção.

### Variants
`on-track`, `attention`, `achieved`, `not-evaluable`.

### Props
```typescript
interface ObjectiveProgressProps {
  objective: { id: string; title: string; href: string };
  metric: { key: string; label: string; unit: string };
  baseline?: number | null;
  target?: number | null;
  actual?: number | null;
  projected?: number | null;
  deadline?: string | null;
  requiredPace?: { value: number; unit: string; period: string } | null;
  status: 'on-track' | 'attention' | 'achieved' | 'not-evaluable';
  availability: Availability;
  timestamps: TimestampInfo;
  references: Reference[];
  limitation?: string | null;
}
```

### States
| State | Visual | Behavior |
|---|---|---|
| Ready | Realizado em destaque; alvo e baseline secundários | Abrir objetivo/evidência |
| On-track/attention/achieved | Rótulo textual + ícone | Cor só reforça estado |
| Not-evaluable | Sem barra/percentual | Explica dado/definição ausente e responsável Ops |
| Loading | Skeleton preserva altura | Sem zero temporário |
| Partial/stale/error | Último valor válido, data e limitação | Projeção oculta se não sustentada |

### Responsive Behavior
360px: valores empilhados, rótulo antes do número. 768px: grade de 2–3 valores. 1280px: comparação horizontal; prosa limitada.

### Accessibility
Se houver barra, `role="progressbar"` apenas quando min/max/valor forem válidos; sempre duplicar em texto. Números usam leitura com unidade. Não usar apenas seta/cor.

### Animations
Mudança de valor sem contagem animada obrigatória; transição até 180ms; reduced motion sem transição.

### Composition
Card, heading link, status Badge, definição métrica, conjunto baseline/realizado/alvo, ritmo, datas e referências.

### Edge Cases
Meta zero/negativa usa regra de domínio; prazo ausente não produz atraso; realizado acima do alvo não extrapola visual; projeção sempre rotulada “Projeção”.

### Dependencies
Card, Badge, Alert, formatação de unidade e EvidencePanel.

### Implementation Notes
Cálculos no domínio/servidor; componente só apresenta contrato. Testar zero verdadeiro versus null, unidades, prazo e RTL numérico não aplicável.

### Implementation Target
- **Agent:** `nextjs-senior-engineer`.
- **File location:** `apps/web/src/components/app/command-center/objective-progress.tsx`.

### Acceptance Criteria
- [ ] Realizado e projeção não se confundem.
- [ ] Estado não avaliável não contém percentual inventado.
- [ ] Zero aparece apenas em disponibilidade válida.
- [ ] Comparação é compreensível sem cor ou gráfico.

---

## Component: PriorityCard

### Purpose
Explicar por que algo está entre as até três prioridades e oferecer exatamente um próximo passo concreto.

### Variants
`opportunity`, `risk`, `blocker`, `monitoring`.

### Props
```typescript
interface PriorityCardProps {
  priority: {
    id: string;
    title: string;
    summary: string;
    kind: 'opportunity' | 'risk' | 'blocker' | 'monitoring';
    rank: 1 | 2 | 3;
    rankReason: string;
    objective?: { id: string; title: string } | null;
    supportedAction: { label: string; href: string; state: 'available' | 'in-progress' | 'blocked' };
    evidenceSummary: Reference[];
    limitation?: string | null;
  };
  onOpenEvidence: () => void;
  onDismiss?: (reason?: string) => Promise<void>;
  canDismiss: boolean;
}
```

### States
| State | Visual | Behavior |
|---|---|---|
| Default | Ordem, tipo textual, motivo, ação | Ação principal única |
| Hover/focus/active | Feedback discreto no controle | Card não é duplo alvo |
| In progress | Badge “Em acompanhamento” | CTA vira “Acompanhar” |
| Blocked | Limitação + impacto | Sem CTA impossível; Ops assume |
| Dismissing/loading | Conteúdo estável, controles bloqueados | Resultado anunciado |
| Error | Alert local preserva card | Tentar novamente sem perder contexto |

### Responsive Behavior
360px: ações empilhadas e detalhes full-screen. 768px: cards em uma coluna ou duas somente se textos não comprimirem. 1280px: até três em grade, alturas não precisam ser artificialmente iguais.

### Accessibility
Artigo/list item com heading; rank textual (“Prioridade 1 de 3”); menu de dispensar nomeado; motivo opcional. Alvo primário 44px. Escape fecha menu sem dispensar.

### Animations
Hover até 150ms; remoção só após confirmação do servidor e com alternativa reduced-motion; sem reordenação animada que desoriente foco.

### Composition
Status/rank → título/resumo → objetivo/motivo da ordem → evidência/limitação → uma ação principal + ações secundárias.

### Edge Cases
Prioridade duplicada/em execução vira acompanhamento; mais de três ficam fora de Hoje mas acessíveis em Operação; bloqueio crítico relevante permanece visível; sem evidência não pode ser “oportunidade” pronta.

### Dependencies
Card, Badge, Button, menu, Alert, EvidencePanel.

### Implementation Notes
Ranking vem do servidor com justificativa; não recalcular no cliente. Testar dispensa concorrente e retorno de erro.

### Implementation Target
- **Agent:** `nextjs-senior-engineer`.
- **File location:** `apps/web/src/components/app/command-center/priority-card.tsx`.

### Acceptance Criteria
- [ ] No máximo três em Hoje e bloqueio crítico não some.
- [ ] Motivo da ordem e objetivo relacionado são explícitos.
- [ ] Uma única ação principal reflete capacidade real.
- [ ] Dispensar não é obrigatório nem executa outra ação.

---

## Component: EvidencePanel

### Purpose
Permitir verificar definição, valor, período, fonte, tempos, cobertura e limitações; distinguir tipos de evidência.

### Variants
`complete`, `partial`, `stale`, `failed`.

### Props
```typescript
interface EvidencePanelProps {
  open: boolean;
  title: string;
  definition: string;
  unit?: string | null;
  period?: { from: string; to: string } | null;
  items: Array<{
    id: string;
    kind: EvidenceKind;
    sourceLabel: string;
    valueSummary: string;
    timestamps: TimestampInfo;
    coverage?: string | null;
    limitation?: string | null;
  }>;
  availability: Availability;
  pagination?: { page: number; pageCount: number; nextHref?: string } | null;
  onOpenChange: (open: boolean) => void;
  onReportDivergence?: () => void;
}
```

### States
| State | Visual | Behavior |
|---|---|---|
| Complete | Definição + itens e proveniência | Drill-down paginado |
| Partial/stale | Alert e última validade | Preserva versões |
| Failed | Última evidência separada da falha | Relatar divergência/tratamento real |
| Empty | “Fonte ainda não disponível” | Sem zero ou tarefa ao cliente |
| Loading | Skeleton de linhas | Mantém painel aberto |

### Responsive Behavior
360px: Sheet/tela inteira com header e fechar persistentes. 768px: Sheet amplo. 1280px: painel lateral até largura de leitura, sem cobrir acionador/foco.

### Accessibility
Dialog/Sheet com nome e descrição; foco inicial no heading, foco contido, Escape fecha, retorno ao acionador. Lista/tabela semântica. Timestamps têm rótulos “evento”, “ingestão”, “cálculo”.

### Animations
Painel até 240ms; reduced motion imediato. Paginação não move foco ao topo da página, apenas ao heading da lista.

### Composition
Header → definição/unidade/período → disponibilidade → itens por proveniência → paginação → divergência.

### Edge Cases
Múltiplas fontes conflitantes aparecem lado a lado; conteúdo longo quebra linha; destinatário/limite sensível nunca trunca; referência indisponível conserva rótulo sem link.

### Dependencies
Dialog/Sheet, Alert, Badge, tabela/paginação e Button.

### Implementation Notes
Paginação e autorização no servidor; não enviar dataset inteiro. Testar foco, conflito, timestamps e tenant.

### Implementation Target
- **Agent:** `nextjs-senior-engineer`.
- **File location:** `apps/web/src/components/app/command-center/evidence-panel.tsx`.

### Acceptance Criteria
- [ ] Definição, fonte, período, ingestão, cálculo e limitação estão disponíveis.
- [ ] Observado, relatado e inferido têm rótulos textuais.
- [ ] Conflitos não são sobrescritos.
- [ ] Foco e fechamento funcionam por teclado em todos os tamanhos.

---

## Component: DecisionCard

### Purpose
Apresentar compromisso e alcance de uma decisão versionada antes de qualquer efeito, refletindo regime, capacidade e permissão reais.

### Variants
`pending`, `decided`, `changed-or-expired`, `blocked`, `submitting`, `error`.

### Props
```typescript
interface DecisionCardProps {
  decision: {
    id: string;
    version: number;
    objective: { id: string; title: string };
    actionLabel: string;
    rationale: string;
    scope: { summary: string; affectedCount?: number; affectedLabels?: string[] };
    responsible: { id: string; label: string };
    channel?: string | null;
    scheduledFor?: string | null;
    costOrLimit?: string | null;
    expectedOutcome: string;
    regime: AuthorizationRegime;
    capabilities: { execute: boolean; cancel: boolean; undo: boolean };
    status: 'pending' | 'approved' | 'rejected' | 'changed' | 'expired' | 'blocked';
    resolvedBy?: string | null;
    resolvedAt?: string | null;
    limitation?: string | null;
  };
  canDecide: boolean;
  onApprove: (input: { decisionId: string; version: number; idempotencyKey: string }) => Promise<void>;
  onRequestChange: () => void;
  onReject: (reason?: string) => Promise<void>;
}
```

### States
| State | Visual | Behavior |
|---|---|---|
| Pending | Alcance completo + ação específica | Aprovar, ajustar, recusar |
| Submitting | Conteúdo preservado, `aria-busy` | Evita novo comando; servidor idempotente |
| Decided | Autor/papel, hora, estado da execução | Sem nova decisão |
| Changed/expired | Versão atual destacada | Exige nova revisão; aprovação antiga não vale |
| Blocked/no permission | Limitação/papel necessário | Sem controle impossível |
| Timeout/error | Estado “confirmando” ou erro local | Reconciliar antes de retry |

### Responsive Behavior
360px: informações e ações empilhadas; resumo de alcance expandido por padrão; ação principal 44px. 768px: duas colunas apenas para metadados. 1280px: conteúdo e resumo lateral, ações sempre após alcance.

### Accessibility
Região com heading; status textual; campos decisórios em `dl`; confirmação de risco em AlertDialog quando necessária. Tab lógico; Enter/Espaço ativam; Escape cancela diálogo sem decidir. Resultado anunciado em live region polida.

### Animations
Feedback 120–180ms; não remover conteúdo ao enviar; spinner não é único indicador.

### Composition
Cabeçalho/status → objetivo/motivo → ação/alcance → responsável/canal/momento/custo → regime/capacidades → resultado esperado → ações.

### Edge Cases
Lista grande usa contagem + expansão integral; nunca trunca condições/limites; clique duplo retorna mesma execução; decisão concorrente mostra estado real; cancelar/desfazer só quando capacidade verdadeira.

### Dependencies
Card, Badge, Alert, Button, AlertDialog e formatadores por tipo de ação. Substitui apresentação crua por `Object.entries`.

### Implementation Notes
Preview formatado por tipo de ação; revalidação completa no servidor. Testes de versão, permissão, idempotência, concorrência, timeout e conteúdo sensível.

### Implementation Target
- **Agent:** `nextjs-senior-engineer`.
- **File location:** `apps/web/src/components/app/command-center/decision-card.tsx`.

### Acceptance Criteria
- [ ] Usuário vê alcance, responsável, canal, custo/limite, regime e resultado esperado.
- [ ] Aprovação liga-se exatamente à versão exibida.
- [ ] Estado retornado não promete execução concluída.
- [ ] Conteúdo decisório não fica escondido em tooltip/truncamento.

---

## Component: ExecutionTimeline

### Purpose
Dar previsibilidade ao trabalho delegado com eventos automáticos, proveniência e próxima etapa, sem botão obrigatório de atualização.

### Variants
`queued`, `running`, `partial`, `blocked`, `unconfirmed`, `failed`, `completed`, `cancelled`.

### Props
```typescript
interface ExecutionTimelineProps {
  planId: string;
  status: 'queued' | 'running' | 'partial' | 'blocked' | 'unconfirmed' | 'failed' | 'completed' | 'cancelled';
  events: Array<{
    id: string;
    occurredAt: string;
    label: string;
    description?: string | null;
    kind: EvidenceKind | 'system';
    sourceLabel: string;
    responsible?: string | null;
    status: string;
  }>;
  nextExpectedEvent?: { label: string; expectedAt?: string | null } | null;
  limitation?: string | null;
  capabilities: { cancel: boolean; pause: boolean };
  onCancel?: () => Promise<void>;
  onPause?: () => Promise<void>;
}
```

### States
| State | Visual | Behavior |
|---|---|---|
| Queued/running | Estado e próximo evento | Atualiza por revalidação/poll/evento, não pela presença do usuário |
| Partial | Concluídos e pendentes separados | Não chama conjunto de concluído |
| Blocked/unconfirmed | Limitação e dependência | Ops recebe lacuna; etapas independentes seguem |
| Failed | Último evento válido + falha | Recovery real e auditável |
| Completed | Resultado operacional concluído | Direciona à medição, não declara sucesso comercial |
| Cancelled | Efeitos ocorridos permanecem | Sem promessa de desfazer |

### Responsive Behavior
360px: lista vertical; detalhes expansíveis em full-screen. 768px: lista vertical com metadados em duas colunas. 1280px: linha do tempo e resumo lateral; sem linha horizontal dependente de largura.

### Accessibility
`ol` cronológica com heading; cada evento tem horário, estado e fonte textuais. Atualizações anunciam apenas mudança de alto nível. Ações de cancelamento explicam alcance e retornam foco.

### Animations
Novo evento pode realçar por até 180ms; sem movimento contínuo/pulso infinito; reduced motion desliga.

### Composition
Resumo/status → próximo evento → lista ordenada → limitação → capacidades reais.

### Edge Cases
Eventos atrasados ordenados por evento e distinguem ingestão; relatos não substituem observação; execução parcial preserva contagens; lista longa paginada/segmentada por data.

### Dependencies
Badge, Alert, Button, Dialog e EvidencePanel.

### Implementation Notes
Fonte única em `packages/execution`; frontend não cria executor paralelo. Testar reconciliação atrasada, cancelamento e ausência de página aberta.

### Implementation Target
- **Agent:** `nextjs-senior-engineer`.
- **File location:** `apps/web/src/components/app/command-center/execution-timeline.tsx`.

### Acceptance Criteria
- [ ] Não existe controle obrigatório “Atualizar status”.
- [ ] Estado, fonte, responsável e próximo evento são legíveis.
- [ ] Parcial/concluído e operacional/comercial são distintos.
- [ ] Pausar/cancelar só aparecem com capacidade real.

---

## Component: OutcomeReview

### Purpose
Fechar o ciclo comparando definição, baseline, alvo e observado, separando efeito operacional de resultado comercial.

### Variants
`measuring`, `measured`, `not-measurable`, `review-needed`.

### Props
```typescript
interface OutcomeReviewProps {
  review: {
    id: string;
    version: number;
    plan: { id: string; title: string };
    objective: { id: string; title: string };
    measurement: { indicator: string; unit: string; cohort?: string | null; window: string };
    baseline?: number | null;
    target?: number | null;
    observed?: number | null;
    operationalResults: Array<{ label: string; value: number | string; availability: Availability }>;
    status: 'measuring' | 'measured' | 'not-measurable' | 'review-needed';
    attributionStatement: string;
    references: Reference[];
    limitation?: string | null;
    nextReviewAt?: string | null;
  };
  canResolve: boolean;
  onContinue?: () => Promise<void>;
  onAdjust?: () => void;
  onClose?: () => Promise<void>;
}
```

### States
| State | Visual | Behavior |
|---|---|---|
| Measuring | Janela/condição e próxima revisão | Sem conclusão prematura |
| Measured | Comparação + atribuição | Continuar, ajustar ou encerrar |
| Not measurable | Lacuna e impacto | Ops assume; sem zero |
| Review needed | Resultado abaixo/definição alterada | Proposta pronta, sem encerramento automático |
| Loading/error | Conteúdo anterior preservado | Atualização falha separada do valor anterior |

### Responsive Behavior
360px: comparações empilhadas, tabela horizontal evitada. 768px: grade 2×N. 1280px: síntese + evidência lateral; tabela/gráfico cabem no conteúdo.

### Accessibility
Valores em `dl`/tabela; gráfico sempre tem tabela equivalente. Tendência textual. Ações de fechar/ajustar explicitam efeito. Foco no estado após decisão.

### Animations
Mudanças 120–180ms, sem contar valores; reduced motion respeitado.

### Composition
Objetivo/plano → definição/janela → baseline/alvo/observado → resultados operacionais → atribuição/limitação → evidências → decisão.

### Edge Cases
Meta posterior não reescreve revisão; coortes incompatíveis não se comparam; sobreposição impede soma de impacto; evento atrasado cria atualização versionada.

### Dependencies
Card, Badge, Alert, Button, EvidencePanel, tabela e gráfico existente quando apropriado.

### Implementation Notes
Cálculo e causalidade no domínio; componente não infere. Testar null/zero, janela, versão, tabela alternativa e eventos atrasados.

### Implementation Target
- **Agent:** `nextjs-senior-engineer`.
- **File location:** `apps/web/src/components/app/command-center/outcome-review.tsx`.

### Acceptance Criteria
- [ ] Definição, unidade, coorte/janela, baseline, alvo, observado e fonte aparecem.
- [ ] Atividade não é apresentada como resultado comercial.
- [ ] “Variação observada” não vira causalidade sem método.
- [ ] Ajuste e encerramento são decisões explícitas, nunca automáticas.

---

## Component: EvidenceGapQueue

### Purpose
Concentrar no backoffice lacunas e conflitos por impacto, com responsável e próximo passo, impedindo que a complexidade seja repassada ao cliente.

### Variants
`new`, `in-progress`, `waiting-source`, `waiting-response`, `resolved`, `unresolved`.

### Props
```typescript
interface EvidenceGapQueueProps {
  gaps: Array<{
    id: string;
    tenant: { id: string; label: string };
    plan?: { id: string; label: string } | null;
    subject: string;
    impact: 'critical' | 'high' | 'medium' | 'low';
    status: 'new' | 'in-progress' | 'waiting-source' | 'waiting-response' | 'resolved' | 'unresolved';
    sourcesAttempted: Array<{ label: string; attemptedAt: string; outcome: string }>;
    attempts: number;
    assignee?: { id: string; label: string } | null;
    nextStep?: string | null;
    nextAttemptAllowedAt?: string | null;
    duplicateCount?: number;
  }>;
  filters: { tenantId?: string; status?: string[]; assigneeId?: string; impact?: string[] };
  pagination: { page: number; pageCount: number };
  capabilities: { reconcile: boolean; configure: boolean; contact: boolean; resolve: boolean };
  onReconcile: (gapId: string) => void;
  onCorrectConfiguration: (gapId: string) => void;
  onPrepareClarification: (gapId: string) => void;
  onRecordLimitation: (gapId: string) => void;
}
```

### States
| State | Visual | Behavior |
|---|---|---|
| New | Impact/status textual, sem responsável | Atribuir ou iniciar tratamento |
| In progress | Responsável/próximo passo | Histórico preservado |
| Waiting source/response | Próxima tentativa permitida | Sem contato duplicado |
| Resolved | Resolução e evidência vinculada | Somente leitura/auditoria |
| Unresolved | Limitação e motivo | Cliente vê impacto pertinente, não tarefa |
| Loading/error/empty | Skeleton; erro local; “sem lacunas” | Filtros e conteúdo preservados |

### Responsive Behavior
360px não é alvo operacional primário, mas deve ser consultável em cards. 768px: tabela responsiva com painel de detalhe. 1280px: tabela densa, filtros e painel lateral; sem importação do visual Warm Command.

### Accessibility
Tabela com caption/headers/sort state; filtros nomeados; seleção não depende de checkbox sem label. Painel de detalhe gerencia foco. Ações em lote anunciam contagem, falhas e preservam seleção segura.

### Animations
Até 150ms; sem scan/pulso contínuo como indicador de trabalho; reduced motion.

### Composition
Filtros → contagem/priorização → tabela/lista → detalhe com evidências/tentativas → ações permitidas → histórico.

### Edge Cases
Deduplicação entre planos/canais; fonte resolve enquanto pergunta está pendente; conflito não sobrescreve; tenant nunca muda dentro do detalhe; ação em lote parcial retorna itens que falharam.

### Dependencies
Primitivos e tokens do admin: tabela, Badge, Alert, Button, Dialog/Sheet, filtros e paginação. Não depender de componentes visuais do app, exceto contratos de dados compartilháveis.

### Implementation Notes
Paginação/filtros no servidor; isolamento e permissões em toda ação; medir tempo/custo Ops e recorrência. Testes de deduplicação, tenant, contato, cancelamento de pergunta e lote parcial.

### Implementation Target
- **Agent:** `nextjs-senior-engineer`.
- **Framework notes:** leitura RSC; mutações localizadas; consultar `apps/admin/AGENTS.md` e docs locais do Next antes de implementar.
- **File location:** `apps/admin/src/components/app/evidence-gap-queue.tsx`.

### Acceptance Criteria
- [ ] Toda exceção tem impacto, empresa, responsável e próximo passo.
- [ ] Fontes/tentativas e resolução são auditáveis.
- [ ] Deduplicação e limites impedem cobranças repetidas.
- [ ] Nenhum dado de outra empresa entra no detalhe ou contato.
- [ ] Operação absorve a lacuna sem criar tarefa de reporte ao cliente.

## Regras compartilhadas de composição

- Cabeçalho sempre inclui heading e status textual; conteúdo segue contexto → evidência → ações.
- Evitar componente genérico com dezenas de flags; cada contrato mantém semântica própria.
- Loading preserva dimensão; disabled explica impedimento; erro não apaga conteúdo revisado.
- Títulos quebram linha; destinatários, condições, alcance e limites nunca truncam silenciosamente.
- Conversa contextual usa `ChatPanel` existente, mas recebe referência estruturada persistida e autorizada; `?q=` é conveniência, não vínculo.
- `PlanDetail` é composição de página com estes componentes, não nono componente genérico.