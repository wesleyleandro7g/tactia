# Etapa 8 — Handoff de design (Web UI)

Artefato de design que antecede a implementação. Escopo: exatamente o da Etapa 8 do
[PLANO-EXECUCAO.md](../PLANO-EXECUCAO.md) e das seções 54, 55 e 57 da [spec](../spec.md).
Não é um BI, não é um design system completo: é a interface mínima que fecha o ciclo da V0.1.

---

## 1. Usuários e contexto

| Persona | Objetivo | Contexto de uso | Papel no sistema |
|---|---|---|---|
| **Dono/gestor** (persona primária) | Saber o que aconteceu no negócio e o que fazer hoje | Desktop, 5–10 min por dia, entre reuniões | `owner`/`admin` |
| **Operador da Tactia** (founder) | Colocar um cliente para rodar e diagnosticar sync | Desktop, sessões longas | `owner` + e-mail na allowlist de operador |
| **Vendedor/analista** | Consultar números e receber tarefas | Desktop e às vezes celular | `member`/`viewer` |

Contexto do produto: os dados chegam por importação (CSV/Postgres), as métricas e insights são
determinísticos (Etapas 4–5), o chat responde com evidência (Etapa 6) e ações só executam após
aprovação humana (Etapa 7). A UI é a primeira vez que esse encadeamento fica visível.

**Restrições existentes que a UI deve respeitar**

- Tema escuro já estabelecido em `globals.css` (`--bg`, `--fg`, `--muted`, `--accent`, `--card`, `--border`).
- Tailwind v4 (sem `tailwind.config.ts`; tokens via `@theme`), Next.js App Router, React 19.
- Todas as mutações passam por `/api/v1/*` (validado e auditado); leitura pode usar services direto no servidor.
- Tenant vem sempre da sessão (cookie `tactia-tenant-id`), nunca do input do usuário.
- pt-BR em toda a interface; moeda e datas no formato brasileiro.

**Acessibilidade esperada:** WCAG 2.1 AA — contraste ≥ 4.5:1 em texto, foco visível em todo
elemento interativo, navegação completa por teclado, estados anunciados por leitor de tela,
nenhum significado transmitido só por cor (severidade e status sempre com rótulo textual).

---

## 2. Arquitetura de navegação

```text
/                       marketing mínimo (existente)
/login  /signup         autenticação (existente, restilizada)
/app                    → redireciona para /dashboard
├── /dashboard          visão do dia (spec §57)
├── /chat               conversa com a Tactia (+ /chat/[id])
├── /approvals          fila de aprovações
├── /onboarding         wizard de dados (spec §55)
└── /admin              painel do operador (spec §54, allowlist)
```

Regras de entrada, aplicadas no layout do grupo `(app)`:

| Condição | Destino |
|---|---|
| Sem sessão | `/login` (com `returnTo`) |
| Sessão sem tenant ativo | `/onboarding` |
| Tenant ativo sem nenhuma venda | `/dashboard` com estado vazio apontando para `/onboarding` |
| `/admin` sem e-mail na allowlist | 404 (não revela a existência do painel) |

---

## 3. Fluxos e estados

### Fluxo A — Primeiro acesso (onboarding, spec §55)

**Objetivo:** sair do zero até "dados importados e primeiros insights".
**História:** como dono, quero conectar minha fonte de dados e ver meus números sem falar com ninguém.
**Gatilho:** signup, ou `/dashboard` vazio, ou `/onboarding` direto.

```text
[Signup / sem tenant]
        │
        ▼
┌──────────────────────┐
│ 1. Empresa           │ nome → POST /api/v1/tenants
└──────────────────────┘
        │
        ▼
┌──────────────────────┐
│ 2. Fonte de dados    │ CSV (caminho do arquivo) ou PostgreSQL (host/db/user/senha)
└──────────────────────┘
        │
        ▼
◇ Conexão OK?  ── não ──▶ erro inline com a mensagem do connector, permanece no passo 2
        │ sim
        ▼
┌──────────────────────┐
│ 3. Descoberta        │ recursos e colunas detectadas
└──────────────────────┘
        │
        ▼
┌──────────────────────┐
│ 4. Mapeamento        │ coluna origem → campo canônico + transformação
└──────────────────────┘
        │
        ▼
┌──────────────────────┐
│ 5. Prévia            │ 20 primeiras linhas normalizadas
└──────────────────────┘
        │
        ▼
┌──────────────────────┐
│ 6. Importação        │ POST /sync (contadores do SyncJob)
└──────────────────────┘
        │
        ▼
[Resultado: ✓ X clientes, ✓ Y vendas, ✓ Z vendedores, ✓ R$ N analisados] → /dashboard
```

**Estados por passo**

| Passo | Loading | Vazio | Erro | Sucesso |
|---|---|---|---|---|
| 1 Empresa | botão "Criando…" desabilitado | — | slug duplicado (`CONFLICT`) inline no campo | avança e mostra o nome no topo |
| 2 Fonte | "Testando conexão…" | — | `CONNECTOR_ERROR` com a mensagem do driver + botão "Testar novamente" | badge verde "conexão ok" |
| 3 Descoberta | skeleton de tabela | "Nenhum recurso encontrado" + voltar ao passo 2 | idem erro de conexão | lista de recursos/colunas |
| 4 Mapeamento | — | "Nenhuma coluna detectada" | destino obrigatório não preenchido | resumo "N campos mapeados" |
| 5 Prévia | skeleton de 5 linhas | "Sem linhas para pré-visualizar" (segue permitido importar) | erro de leitura | tabela com as linhas |
| 6 Importação | barra/contadores "lidos/criados/atualizados/falhas" | — | `SYNC_ERROR` com link para o job | tela de resultado |

**Edge cases:** recarregar a página no meio do wizard reinicia do passo correspondente ao estado
real do servidor (fonte já criada → passo 3); sessão expirada volta para `/login` preservando
`returnTo`; sync já em andamento mostra o job existente em vez de criar outro.

**Foco e anúncios:** ao trocar de passo, o foco vai para o título do passo (`h2` com `tabindex="-1"`);
o stepper usa `aria-current="step"`; contadores da importação em `aria-live="polite"`.

---

### Fluxo B — Dia a dia (dashboard, spec §57)

**Objetivo:** em 30 segundos saber como está o mês e o que precisa de atenção.

Estrutura fixa, sem configuração:

1. **Overview** — 4 cards: Receita, Vendas, Clientes, Ticket médio; cada um com valor do período e
   variação vs. período anterior (seta + rótulo textual "vs. mês anterior").
2. **Tendências** — Receita no tempo e Vendas no tempo (série diária do período).
3. **Insights** — agrupados por severidade (crítico, alto, médio), com evidência resumida.
4. **Recomendações pendentes** — cada uma com aceitar/rejeitar.

| Estado | Comportamento |
|---|---|
| Loading | skeletons nos cards e nos gráficos (streaming de RSC por seção) |
| Vazio (sem vendas) | painel único: "Nenhum dado importado ainda" + CTA para `/onboarding` |
| Parcial | período sem vendas mas com histórico: cards em 0 com nota "sem vendas no período" |
| Erro | seção degradada isoladamente ("não foi possível calcular receita") sem derrubar a página |
| Sem insights | "Nenhum insight aberto" + botão "Rodar análise" (`POST /api/v1/insights`) |

Ações inline: aceitar/rejeitar recomendação (otimista, com reversão em erro e `aria-live` para o
resultado); trocar período (mês atual, 30 dias, 90 dias) via query string (`?from=&to=`), o que
mantém a URL compartilhável.

---

### Fluxo C — Perguntar à Tactia (chat)

```text
[/chat] → cria/usa conversa → pergunta
        │
        ▼ SSE: tool_call → tool_result → text… → done
   resposta com "Fonte: receita — 01/08/2026 a 01/09/2026"
        │
        ├─ resposta contém proposta de ação → cartão com "Aprovar" / "Recusar"
        └─ erro (AI_ERROR) → aviso "IA indisponível" + botão "Tentar novamente"
```

| Estado | Comportamento |
|---|---|
| Sem conversas | tela de boas-vindas com 4 perguntas sugeridas (spec §58) |
| Enviando | mensagem do usuário aparece imediatamente; assistente mostra "consultando dados…" quando há `tool_call` |
| Streaming | texto acumula token a token; `aria-live="polite"` na bolha em construção |
| Fontes | chip discreto por mensagem, expansível, com métrica e período |
| Proposta | cartão com tipo da ação, payload legível e status "pendente de aprovação" |
| Erro | bolha de erro com código traduzido; a pergunta permanece no campo para reenvio |
| LLM não configurado | banner "Configure LLM_API_KEY para usar o chat" e campo desabilitado |

**Teclado:** `Enter` envia, `Shift+Enter` quebra linha, `Esc` limpa o campo; foco volta ao campo
após a resposta.

---

### Fluxo D — Aprovar uma ação

Fila em `/approvals` (padrão: pendentes). Cada item mostra o que será executado (tipo + payload
formatado), quem pediu, quando e o motivo. Aprovar executa e o item passa a exibir o resultado
(output ou erro). Rejeitar pede motivo opcional e cancela a execução.

| Estado | Comportamento |
|---|---|
| Vazio | "Nenhuma aprovação pendente" |
| Processando | botões desabilitados com "Aprovando…"; a linha inteira em `aria-busy` |
| Sucesso | badge "executada" + resumo do output (ex.: "tarefa criada") |
| Falha na execução | badge "falhou" + mensagem do erro, sem stack trace |
| Sem permissão (member/viewer) | botões ausentes + nota "apenas owner/admin aprova" |
| Conflito (já decidida em outra aba) | aviso "esta aprovação já foi decidida" + refresh |

---

### Fluxo E — Painel do operador (spec §54)

Acesso só por allowlist de e-mail. Cross-tenant, portanto todo acesso é auditado.

Listas: tenants (com contagem de usuários/fontes/vendas), fontes de dados por tenant, sync jobs
recentes com status e erro, insights recentes. Ações: disparar sync e reprocessar import.

| Estado | Comportamento |
|---|---|
| Não operador | 404 |
| Vazio | "Nenhum tenant" / "Nenhum job" |
| Ação em andamento | botão com "Disparando…" e resultado inline |
| Erro | mensagem do job com `error` e `request_id` para correlacionar log |

---

## 4. Especificação de componentes

Convenção: primitivos em `src/components/ui/*` (estilo shadcn, escritos à mão, sem CLI);
componentes de produto em `src/components/app/*`. Server Components por padrão; `'use client'`
apenas onde há estado ou streaming.

### MetricCard

- **Propósito:** mostrar uma métrica do período com comparação.
- **Props:** `label: string`, `value: string`, `deltaFraction?: number`, `comparisonLabel?: string`, `hint?: string`.
- **Variantes:** `default`, `emphasis` (receita), `muted` (sem dados).
- **Estados:** normal; sem comparação (esconde a linha de delta); zero (valor "R$ 0,00" + nota); loading (skeleton).
- **Responsivo:** 4 colunas ≥1024px, 2 colunas ≥640px, 1 coluna abaixo.
- **A11y:** `<article>` com `aria-labelledby` no rótulo; delta com texto ("+12,4% vs. mês anterior"), a seta é decorativa (`aria-hidden`).

### TrendChart

- **Propósito:** série temporal de receita ou vendas, sem dependência de biblioteca.
- **Props:** `points: { key: string; value: number }[]`, `format: 'currency' | 'integer'`, `label: string`.
- **Estados:** com dados (área + linha); ≤1 ponto ("dados insuficientes para tendência"); vazio ("sem vendas no período").
- **Responsivo:** SVG com `viewBox` e `preserveAspectRatio`, altura fixa 180px, largura fluida.
- **A11y:** `role="img"` + `aria-label` com resumo (mín./máx./total) e `<table class="sr-only">` com os pontos — o dado nunca fica só no gráfico.
- **Motion:** sem animação de entrada (evita ruído em dashboard); apenas `transition-colors` no hover do ponto.

### InsightCard / InsightGroup

- **Props:** `insight: { id, title, description, severity, type, ruleKey, period, evidence[] }`.
- **Severidade → token + rótulo:** `critical` (danger, "Crítico"), `high` (warning, "Alto"), `medium` (info, "Médio"), `low` (muted, "Baixo").
- **Estados:** aberto; com recomendação vinculada (mostra contagem); evidência colapsada por padrão.
- **A11y:** severidade como `Badge` com texto; grupos com `<h3>` e lista `<ul>`.

### RecommendationItem (client)

- **Props:** `recommendation`, `onDecided?`.
- **Estados:** pendente (aceitar/rejeitar); enviando (ambos desabilitados); aceita/rejeitada (badge, botões saem); erro (alerta inline + retry).
- **A11y:** botões com `aria-label` incluindo o título; resultado em `aria-live="polite"`.

### ChatComposer + ChatMessage + SourceChips + ProposalCard (client)

- **ChatComposer:** `textarea` auto-crescente, contador só a partir de 3.500/4.000 caracteres, `disabled` quando streaming.
- **ChatMessage:** variantes `user` | `assistant` | `error`; `pending` mostra três pontos animados (respeita `prefers-reduced-motion`).
- **SourceChips:** lista de `{ metric, period, label }`; renderiza "Fonte: receita — 01/08 a 25/08".
- **ProposalCard:** tipo da ação, payload em lista de pares, status, botões aprovar/recusar (só owner/admin) e link para `/approvals`.

### WizardStepper + StepPanel (client)

- **Props:** `steps: { id, label }[]`, `current: number`, `completed: number[]`.
- **Estados:** passo atual, concluído (✓), futuro (desabilitado, não clicável), com erro (marcador danger).
- **Responsivo:** horizontal ≥768px; abaixo, "Passo 3 de 6 — Mapeamento".
- **A11y:** `<ol>` com `aria-current="step"`; navegação só por botões de ação (evita pular validação).

### DataTable (leve)

- **Props:** `columns`, `rows`, `emptyLabel`, `caption`.
- **Estados:** normal, vazio, carregando (skeleton de 5 linhas), overflow (scroll horizontal com `tabindex="0"` no container).
- **A11y:** `<caption>` obrigatório (pode ser `sr-only`), `<th scope="col">`.

### AppShell

- Sidebar fixa ≥1024px com Dashboard, Chat, Aprovações, Onboarding e (se operador) Admin; topbar com nome da empresa, seletor de tenant e sair.
- Abaixo de 1024px: topbar com menu em `<details>`/drawer simples, sem dependência extra.
- Item ativo com `aria-current="page"`; skip link "Ir para o conteúdo" como primeiro elemento focável; `main` com `id="conteudo"` e `tabindex="-1"`.

---

## 5. Tokens

Extensão do que já existe, expostos como variáveis CSS e mapeados no `@theme` do Tailwind v4
(gera utilitários `bg-card`, `text-muted`, `border-border`, `text-danger`…).

```css
/* base (já existente) */
--bg: #0f1419;  --fg: #e8eef4;  --muted: #8b9aab;
--accent: #3d8bfd;  --card: #1a222c;  --border: #2a3542;

/* novos — superfícies e semântica */
--card-hover: #202a36;
--fg-subtle: #6b7a8c;
--accent-fg: #ffffff;
--accent-soft: rgba(61, 139, 253, 0.14);
--success: #34d399;  --success-soft: rgba(52, 211, 153, 0.14);
--warning: #fbbf24;  --warning-soft: rgba(251, 191, 36, 0.14);
--danger: #f87171;   --danger-soft: rgba(248, 113, 113, 0.14);
--info: #60a5fa;     --info-soft: rgba(96, 165, 250, 0.14);
--ring: #3d8bfd;
```

**Mapa semântico**

| Papel | Token | Uso |
|---|---|---|
| Positivo / concluído | `success` | delta positivo, execução `completed`, conexão ok |
| Atenção | `warning` | severidade `high`, `awaiting_approval` |
| Negativo / falha | `danger` | severidade `critical`, delta negativo, `failed` |
| Informativo | `info` | severidade `medium`, `running` |
| Neutro | `muted` | severidade `low`, `cancelled`, textos secundários |

Tipografia (system stack já em uso): `text-2xl/semibold` título de página, `text-lg/medium` seção,
`text-sm` corpo denso de painel, `text-xs uppercase tracking-wide text-muted` rótulo de card,
tabular-nums em números.

Ritmo: escala 4px; `gap-4` dentro de cartão, `gap-6` entre cartões, `gap-8` entre seções;
`rounded-xl` em cartões, `rounded-lg` em controles; `max-w-6xl` no conteúdo.

Motion: 150ms para hover/focus, 200ms para entrada de painel, nada acima de 300ms; tudo dentro de
`@media (prefers-reduced-motion: reduce)` → `transition: none`.

Foco: `outline: 2px solid var(--ring); outline-offset: 2px` — nunca `outline: none` sem substituto.

---

## 6. Handoff de engenharia

**Alvo:** `nextjs-senior-engineer`.
**Por quê:** o projeto já é Next.js App Router com Route Handlers em `/api/v1/*`; as telas precisam
de dados no servidor (métricas, insights, aprovações) com Server Components, e o chat depende de
streaming SSE de uma rota de servidor. Não é um SPA cliente-only.

**Contratos de API já disponíveis** (nenhum endpoint novo necessário, exceto o painel do operador):
`/api/v1/metrics`, `/insights`, `/recommendations/:id/{accept,reject}`, `/conversations` (+ `/messages` com `stream: true`),
`/approvals` (+ `/{approve,reject}`), `/action-executions`, `/data-sources` (+ `test-connection`, `discover`, `preview`, `mappings`, `sync`),
`/sync-jobs`, `/tenants` (+ `/:id/switch`).

**Novo, restrito a operador:** `POST /api/v1/admin/sync` e `POST /api/v1/admin/reprocess-import`,
com allowlist por `TACTIA_OPERATOR_EMAILS` e audit log em toda chamada.

### Critérios de aceite

- [ ] Fluxo clicável completo: onboarding → importação → dashboard com dados → insight visível → recomendação → ação proposta → aprovação → execução registrada.
- [ ] Todos os estados de cada fluxo implementados (loading, vazio, parcial, erro, sem permissão), não só o caminho felizes.
- [ ] Toda resposta numérica do chat exibe a fonte (métrica + período).
- [ ] Nenhum número aparece somente em gráfico: sempre há equivalente textual/tabular.
- [ ] Navegação por teclado cobre 100% das ações; foco visível em tema escuro; skip link presente.
- [ ] Severidade e status legíveis sem depender de cor.
- [ ] Layout utilizável em 360px, 768px e 1440px.
- [ ] `/admin` responde 404 para quem não está na allowlist; ações do operador aparecem no audit log.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build` verdes.
