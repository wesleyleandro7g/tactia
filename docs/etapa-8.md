# Etapa 8 — Web UI (Dashboard, Chat, Onboarding, Admin)

**Status:** concluída  
**Data:** 2026-08-30  
**Depende de:** [Etapa 5](./etapa-5.md), [Etapa 6](./etapa-6.md), [Etapa 7](./etapa-7.md)  
**Design:** [handoff da Etapa 8](./etapa-8-design.md) (usuários, fluxos, estados, tokens, a11y)

## Entregue

### Base de UI

| Item | Descrição |
|---|---|
| Dependências | `clsx@2.1.1`, `tailwind-merge@3.6.0`, `class-variance-authority@0.7.1`, `lucide-react@0.37.0` (pinadas) |
| Tokens | `globals.css` expõe as variáveis via `@theme inline` → utilitários `bg-card`, `text-muted`, `text-danger`, `bg-accent-soft`… |
| Semântica | `success` / `warning` / `danger` / `info` + variantes `-soft`, `card-hover`, `fg-subtle`, `ring` |
| Acessibilidade global | `:focus-visible` com contorno de 2px, `prefers-reduced-motion`, classe `.tabular` para números |
| Helpers | `lib/cn.ts`, `lib/format.ts` (moeda/inteiro/percentual/datas pt-BR, rótulos de métrica, severidade, status e erros), `lib/chart.ts` (geometria do gráfico) |

Kit em `src/components/ui/`: `Button` (5 variantes, 4 tamanhos, `loading` com `aria-busy`),
`Card` + `CardHeader/Title/Description/Label`, `Badge` (+ `severityTone`/`statusTone`),
`Label/Input/Textarea/Select/Field` (com `aria-describedby` e erro em `role="alert"`),
`Alert`, `Skeleton`/`SkeletonCard`/`EmptyState` e `DataTable` (caption obrigatório,
`th scope="col"`, container focável para scroll horizontal).

Escrito à mão no estilo shadcn (copy-paste + cva), sem rodar a CLI e sem Radix: os componentes
desta etapa não precisam de portais nem de foco preso.

### App shell e contexto de servidor

- `lib/server-context.ts`: `getServerContext()` reaproveita o mesmo `resolveRequestContext` das
  rotas `/api/v1/*` (sessão → usuário → tenant → papel) montando um `Request` com os headers
  atuais — não existe uma segunda implementação de autenticação. `requireUser()` e
  `requireTenant()` cuidam dos redirects.
- `app/(app)/layout.tsx`: skip link, navegação lateral com `aria-current`, seletor de empresa,
  sair, `main#conteudo` focável. O item **Admin** só aparece para operador.
- `/app` passou a redirecionar para `/dashboard`.

### Dashboard (spec §57)

- 4 cards: Receita, Vendas, Clientes, Ticket médio — cada um com variação textual vs. período
  anterior (a seta é decorativa).
- 2 gráficos: Receita no tempo e Vendas no tempo, em SVG próprio com `role="img"`,
  `aria-label` resumindo total/mínimo/máximo e tabela `sr-only` com todos os pontos.
- Insights agrupados por severidade (crítico → baixo) com badge textual, evidência determinística
  formatada e a regra que originou o insight.
- Recomendações pendentes com aceitar/rejeitar (otimista, com `aria-live` e reversão em erro).
- Período por query string (`?from=&to=`) com presets Mês atual / 30 dias / 90 dias.
- Botão "Rodar análise" dispara `POST /api/v1/insights`.

### Onboarding (spec §55)

Wizard de 6 passos: **empresa → fonte de dados → descoberta → mapeamento → prévia → importação**,
terminando na tela de resultado (`✓ N clientes`, `✓ N vendas`, `✓ N vendedores`, `✓ R$ X analisados`)
com os contadores do `SyncJob`.

- CSV (caminho no servidor) e PostgreSQL (host/porta/banco/usuário/senha).
- Para Postgres, a senha vai primeiro para `POST /api/v1/credentials` (criptografada) e a fonte
  recebe apenas o `credentialId`.
- O estado inicial vem do servidor: recarregar retoma no passo real (fonte já criada → descoberta).
- Erros de conexão aparecem inline com a mensagem do connector; o passo com erro fica marcado no stepper.

### Chat (Etapa 6 na tela)

- Streaming consumindo o SSE de `POST /api/v1/conversations/:id/messages` (`stream: true`).
- Atividade traduzida durante as tool calls ("Tactia está consultando a receita…").
- Fontes por resposta em `<details>`: "Fonte: Receita — 01/08/2026 a 01/09/2026".
- Proposta de ação como cartão com payload legível, status "Pendente de aprovação" e botões
  **Aprovar e executar** / **Recusar** para owner/admin; para os demais, a nota de que a proposta
  está na fila.
- Conversa é criada só na primeira pergunta (`/chat` = nova, `/chat/[id]` = histórico).
- Banner quando não há `LLM_API_KEY`; `Enter` envia, `Shift+Enter` quebra linha, `Esc` limpa.

### Aprovações (Etapa 7 na tela)

Fila com filtro pendentes/aprovadas/rejeitadas, payload da ação em lista de definições, origem
("proposto pela Tactia" quando `origin=ai`), campo de motivo opcional e, após aprovar, o resultado
da execução (output ou erro). Abaixo, tabela das execuções recentes.

### Admin interno (spec §54)

Restrito por allowlist `TACTIA_OPERATOR_EMAILS`; fora dela a rota responde **404**.

- `/admin`: tenants com contagem de usuários, fontes, vendas e insights.
- `/admin/tenants/[id]`: usuários, fontes (com **Disparar sync**), sync jobs com contadores e erro,
  imports (com **Reprocessar**) e insights recentes.
- Rotas do operador: `POST /api/v1/admin/sync` e `POST /api/v1/admin/reprocess-import` — as duas
  gravam audit log com `actorType: 'operator'` no tenant afetado.

### Testes

`apps/web/src/lib/__tests__/ui-helpers.test.ts` — **12 testes** dos helpers puros:

- formatação BRL, inteiros, delta com sinal, período citado pela IA e travessão para valor inválido;
- `resolveRangeParam` com fallback no mês corrente para intervalo inválido ou invertido;
- `buildChartGeometry`: escala correta, série constante centralizada (sem divisão por zero),
  ponto único sem área, série vazia sem quebrar;
- gate do operador: sem allowlist ninguém entra; comparação ignora caixa e espaços.

**Total do monorepo: 113 testes** (`shared` 2, `web` 12, `intelligence` 22, `ai` 34, `execution` 24,
`domain` 19). `pnpm lint`, `typecheck`, `test` e `build` verdes (9/9 tasks).

### Smoke test com servidor real

Executado em `pnpm dev` com o banco de desenvolvimento (tenant demo com 941 vendas), usuário de
teste criado por signup e removido depois:

| Verificação | Resultado |
|---|---|
| `/dashboard` sem sessão | 307 → `/login` |
| `/dashboard` com sessão sem tenant | 307 → `/onboarding` |
| `/onboarding` | 200 com o passo 1 ("Nome da empresa") |
| `/admin` sem allowlist | 404 |
| `/admin` com `TACTIA_OPERATOR_EMAILS` | 200 com os tenants; detalhe do tenant 200 |
| `/dashboard` sem vendas | estado vazio "Nenhum dado importado ainda" + CTA |
| `/dashboard` com dados | cards R$ 136.158,75 / 89 / 69 / R$ 1.529,87 e gráfico com `aria-label` "Receita no tempo de 01/08 a 29/08. Total R$ 136.158,75, mínimo R$ 262,22, máximo R$ 22.314,86." |
| `POST /api/v1/insights` | 4 insights + 4 recomendações renderizados com severidade e botões acessíveis |
| `/chat` | 200 com as perguntas da spec §58 e banner "Chat indisponível" (sem LLM configurado) |
| Ciclo de execução | propor `create_task` → `/approvals` mostra "Aguardando aprovação" → aprovar → `completed` com `output.activityId` → `Activity` do tipo `task` criada |

## Decisões

- **Server Components para leitura, `/api/v1` para escrita.** As páginas chamam os services no
  servidor (sem hop HTTP nem spinner inicial); toda mutação continua passando pela API já validada e
  auditada. Isso evita duplicar regra de negócio no front.
- **`getServerContext()` reaproveita `resolveRequestContext`** em vez de reimplementar sessão para
  RSC — uma única fonte de verdade para "quem é o usuário e qual é o tenant".
- **Gráficos em SVG próprio, sem biblioteca.** Duas séries simples não justificam recharts (~90 kB);
  em troca ganhamos `aria-label` com resumo e tabela `sr-only`, então nenhum número existe apenas no
  desenho.
- **shadcn à mão, sem CLI e sem Radix.** O kit desta etapa é dropdown simples, tabela, cartão e
  formulário; `<details>` e um listbox com `aria-expanded` resolvem sem dependência extra. Se
  aparecer modal/combobox no futuro, Radix entra pontualmente.
- **Operador por allowlist de e-mail, não por papel.** Criar um papel de operador no modelo de
  domínio contaminaria o multi-tenant (o operador não pertence ao tenant). `TACTIA_OPERATOR_EMAILS`
  mantém isso fora do domínio, e a resposta para quem não é operador é 404 — não 403 — para não
  revelar a existência do painel.
- **Ações do operador reconstroem o contexto no tenant alvo** (`role: 'owner'`) e gravam audit log
  com `actorType: 'operator'`. É o único caminho cross-tenant do sistema e ele é rastreável.
- **`POST /api/v1/credentials` foi adicionada nesta etapa.** A Etapa 3 tinha o `CredentialService`
  sem rota, o que impedia o wizard de conectar Postgres. A rota devolve apenas `{id, provider, createdAt}`.
- **Conversa criada só na primeira pergunta.** `/chat` não cria registro no `GET` (nada de efeito
  colateral em navegação); a conversa nasce quando o usuário realmente pergunta.
- **Estado do wizard vem do banco, não de rascunho no cliente.** Menos código, e o comportamento no
  reload é o correto por construção.
- **Período do dashboard na URL.** Compartilhável e sobrevive ao refresh, sem estado global.
- **Cores nunca sozinhas.** Severidade e status sempre com texto no badge; delta sempre com
  percentual escrito. A seta é `aria-hidden`.

## Como testar manualmente

```bash
docker compose -f docker/docker-compose.yml up -d
pnpm db:migrate:deploy
pnpm db:seed          # owner@demo.tactia / password123
pnpm dev              # http://localhost:3000
```

Fluxo completo (critério de aceite da etapa):

1. `/signup` → criar conta.
2. Você cai em `/onboarding`: crie a empresa, escolha CSV, informe o caminho de um arquivo
   (ex.: `packages/domain/src/__tests__/fixtures/sample-customers.csv`), teste a conexão, confira a
   descoberta, mapeie as colunas, veja a prévia e importe.
3. A tela de resultado mostra as contagens; siga para `/dashboard`.
4. No dashboard: cards e gráficos com dados; clique em **Rodar análise** para gerar insights e
   recomendações; aceite uma recomendação.
5. `/chat` (com `LLM_API_KEY` ou `LLM_PROVIDER=mock`): pergunte "Quanto vendemos este mês?" e
   confira a fonte citada. Peça "crie uma tarefa para ligar para o cliente X" para ver o cartão de
   proposta.
6. `/approvals`: aprove a ação e veja o resultado da execução registrado.
7. Painel do operador: adicione seu e-mail em `TACTIA_OPERATOR_EMAILS` no `.env`, reinicie e acesse
   `/admin`.

```bash
pnpm --filter @tactia/web test   # helpers de UI
```

## Critérios de aceite

| Critério | Evidência |
|---|---|
| Fluxo clicável completo (onboarding → import → dashboard → insight → recomendação → ação → aprovação → execução) | Smoke test acima, incluindo `Activity` criada após a aprovação |
| Dashboard estritamente o da spec §57 | 4 cards + 2 séries + insights por severidade + recomendações pendentes, sem BI extra |
| Onboarding da spec §55 com tela de resultado | Wizard de 6 passos + contagens `✓` |
| Chat com streaming, fontes e proposta com aprovação | `chat-panel.tsx` (SSE, `SourceChips`, `ProposalCard`) |
| Fila de aprovações | `/approvals` com filtros, payload e resultado |
| Admin operacional para diagnóstico | `/admin` + `/admin/tenants/[id]` com sync e reprocessamento |
| UI em português, limpa e funcional | Todas as telas em pt-BR com o kit e os tokens da etapa |
| Estados cobertos (loading, vazio, parcial, erro, sem permissão) | `EmptyState`/`Skeleton`/`Alert` por seção; verificado no smoke test |
| Acessibilidade | skip link, `aria-current`, foco visível, badges com texto, tabela `sr-only` nos gráficos |

## Pendências (próximas etapas)

- **Etapa 9:** E2E automatizado do fluvo da spec §2, revisão de segurança e documentação
  operacional (`docs/onboarding-cliente.md`, `docs/runbook.md`).
- Upload de CSV pela interface (hoje o wizard usa caminho de arquivo no servidor) — depende de
  colocar o `CsvConnector` sobre o object storage.
- Testes de componente/E2E (Playwright ou Testing Library): esta etapa cobriu apenas os helpers
  puros por teste automatizado, o resto foi smoke test manual.
- Paginação e busca nas listas longas (insights, execuções, admin) — hoje limitadas a 10–50 itens.
- Editar mapeamento de uma fonte existente e escolher transformação por campo (`trim`, `number`,
  `date`, `currency`) — o wizard grava sem transformação.
- Layout mobile do menu lateral usa empilhamento simples; um drawer com foco preso melhora a
  experiência em telas pequenas.
