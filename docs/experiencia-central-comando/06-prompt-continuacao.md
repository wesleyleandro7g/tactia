# Prompt de continuação — central de comando

Mantenha este arquivo atualizado ao final de cada etapa, junto com
`05-status-implementacao.md`, para que o próximo handoff continue confiável.

---

## Contexto

Você vai continuar a implementação da **Central de Comando** do Tactia
(`/home/wesleyleandro/Projects/Desencoder/Tactia`), iniciada por outro agente.

Branch: `feat/refact-experience`. Nada foi enviado ao remoto. A modelagem,
serviços, telas, fila do Ops, editor de preparação, flag por empresa, revisão
guiada, eventos, indicadores operacionais do piloto e revisão semanal
consolidada estão nesta branch.

## Leia nesta ordem antes de escrever código

1. `docs/experiencia-central-comando/05-status-implementacao.md` — **comece aqui**:
   estado por entrega, comandos de verificação, decisões a preservar, riscos e
   próximos passos priorizados.
2. `docs/experiencia-central-comando/04-handoff-engenharia.md` — contratos e
   critérios de aceite, com evidência citada nos que já estão cumpridos.
3. `docs/experiencia-central-comando/00-contexto-e-arquitetura.md` — premissas de
   produto, sobretudo a de **esforço operacional zero do cliente**.
4. `docs/esclarecimento-lacunas-whatsapp.md` — operação do Fluxo D.
5. `docs/experiencia-central-comando/07-seed-demo.md` — dados sintéticos para
   inspeção da Central e comando seguro para `tactia_test`.
6. `apps/web/AGENTS.md` e `apps/admin/AGENTS.md` — esta versão do Next (16.3.3)
   tem mudanças de API. **Leia os guias em `node_modules/next/dist/docs/`
   (resolvidos a partir de cada app) antes de escrever qualquer código Next.**

## Sua tarefa

Conclua a **validação visual e de acessibilidade** da Central de Comando nos
três breakpoints (360, 768 e 1280px) e nos dois temas. Não gaste esta etapa com
pesquisa de empresários, deploy ou uma nova entrega de produto. O próximo
desenvolvimento, depois deste, é inspecionar produção e planejar o piloto com
uma empresa real.

Requisitos:

- Parta da revisão estática já registrada em `05-status-implementacao.md`:
  tabelas equivalentes dos gráficos, quebra dos cards abaixo de 480px, contraste
  de tokens de texto/ação e anúncios do editor Ops. A revisão semanal
  consolidada já está em `/results` e no recorte de `/today`.
- Inspecione de fato as rotas novas (`/today`, `/objectives`, `/operations`,
  `/results`) e o recorte da janela consolidada, nos temas claro e escuro.
  Verifique zoom, teclado, foco visível e leitor de tela. Não declare WCAG
  2.2 AA concluída sem essa evidência renderizada.
- Corrija apenas o que a inspeção provar: truncamento de decisão/autorização,
  contraste, alvo de toque das ações primárias, anúncio de estados assíncronos
  e consistência dos eixos (execução ≠ objetivo atingido; `null` ≠ zero).
- Não altere a semântica de confiança, o executor, `recommendations/:id/accept`
  nem os indicadores do piloto no Ops. Não reexecute o seed em produção.
- Se mudar código, cubra o comportamento corrigido e rode as suítes da Central
  como regressão. Typecheck e lint só dos arquivos/pacotes alterados.

Critério de saída: há evidência renderizada nos três breakpoints e nos dois
temas de que o empresário lê a janela consolidada, decide e acompanha sem
perder ação ou número, e de que a interface não depende só de cor para
estado, severidade ou tendência.

## Invariantes que não podem ser quebradas

Estas decisões estão documentadas e sustentadas por teste. Não as reverta sem
apresentar evidência de que estão erradas:

1. `packages/execution` é a **única** fonte de execução e aprovação. Não crie
   executor paralelo no frontend nem no Ops.
2. **Não altere** a semântica de `recommendations/:id/accept`: outros clientes
   dependem dela.
3. **Ops prepara, `apps/web` envia.** O adapter Evolution e a fila vivem no app
   web; o backoffice nunca envia mensagem diretamente.
4. `null` **nunca** vira zero em superfície de confiança. O helper legado
   `decimalToNumber` converte `null` em `0`; use `nullableDecimalToNumber` nos
   DTOs da central.
5. A ação executada tem de ser idêntica à preparada no snapshot do plano, e a
   versão aprovada tem de ser a versão atual.
6. Silêncio ou resposta ambígua **nunca** confirmam nem resolvem uma lacuna.
7. Todo acesso é escopado por tenant, inclusive relações opcionais e links
   diretos.

## Verificação

O banco `tactia_test` e o banco local de desenvolvimento `tactia` já têm as 47
migrações registradas. A situação de produção é desconhecida. **Nunca aponte
migração para o banco de desenvolvimento ou produção sem pedir confirmação ao
usuário.** O baseline especial usado uma vez no banco local não é uma receita
para produção.

```bash
export TEST_DB=postgresql://tactia:tactia@localhost:5433/tactia_test

DATABASE_URL=$TEST_DB pnpm db:migrate:deploy

cd apps/web && DATABASE_URL=$TEST_DB pnpm exec vitest run \
  src/__tests__/command-center-cycle.test.ts \
  src/__tests__/command-center-flow.test.ts \
  src/__tests__/plan-review-decision.test.ts \
  src/__tests__/command-center-cycle-review.test.ts \
  src/lib/__tests__/command-center-flag.test.ts \
  src/lib/__tests__/clarification-flow.test.ts \
  src/__tests__/pilot-flow.test.ts        # esperado: 37/37

cd packages/database && DATABASE_URL=$TEST_DB pnpm exec vitest run \
  src/__tests__/command-center-events.test.ts

cd packages/domain && pnpm exec vitest run \
  src/__tests__/command-center-service.test.ts \
  src/__tests__/command-center-cycle-review.test.ts \
  src/__tests__/evidence-clarification-policy.test.ts \
  src/__tests__/command-center-metrics-service.test.ts

cd apps/admin && DATABASE_URL=$TEST_DB pnpm exec vitest run \
  src/lib/__tests__/settings-routes.test.ts \
  src/lib/__tests__/tenant-tabs.test.ts \
  src/lib/__tests__/command-center-metrics-routes.test.ts   # esperado: 30/30

# typecheck dos 4 pacotes afetados
pnpm --filter @tactia/database typecheck && pnpm --filter @tactia/domain typecheck \
  && pnpm --filter @tactia/web typecheck && pnpm --filter @tactia/admin typecheck
```

Escreva testes para o comportamento consolidado que adicionar. Rode as suítes
relevantes acima como regressão; não presuma que a lista substitui os testes
novos de autorização e isolamento.

## Falhas preexistentes — não gaste tempo nelas

Já foram comprovadas no `HEAD` sem as mudanças da central, via `git stash`:

- 6 testes de `browser-integration`/Torge em `packages/domain` falham por
  validação de URL `app.torge.com.br`.
- `pnpm --filter @tactia/web lint` falha em dois componentes da landing:
  `components/landing/hero-prompt.tsx` e `components/landing/web-threads.tsx`.

Rode lint apenas nos arquivos que você alterar, ou nos pacotes cujo lint está
limpo (`@tactia/database`, `@tactia/domain`, `@tactia/admin`).

## Ao terminar

1. Atualize `05-status-implementacao.md`: mova o item concluído, registre a
   evidência e ajuste riscos e próximos passos.
2. Marque em `04-handoff-engenharia.md` os critérios que você cumprir, citando a
   evidência ao lado. Não marque nada sem prova.
3. Atualize a seção "Sua tarefa" **deste** arquivo para a próxima etapa, para que
   o handoff seguinte continue válido.
4. Commite em partes lógicas, com `git add` de caminhos explícitos — **nunca
   `git add .`**. Siga o padrão dos commits anteriores
   (`feat(database):`, `feat(domain):`, `feat(web):`, `feat(ops):`, `docs(...)`).
5. Não faça `push`, `--amend`, `reset --hard` nem force push sem o usuário pedir.

## Como reportar

Diga o que verificou e com qual saída de comando, e separe explicitamente o que
**não** foi verificado. Se algo ficar pendente ou bloqueado, registre no
documento de status em vez de deixar apenas na conversa.
