# Prompt de continuação — central de comando

Cole o conteúdo abaixo em uma sessão nova de agente. Ele é autossuficiente: não
depende do histórico de conversa que originou a implementação.

Mantenha este arquivo atualizado ao final de cada etapa, junto com
`05-status-implementacao.md`, para que o próximo handoff continue confiável.

---

## Contexto

Você vai continuar a implementação da **Central de Comando** do Tactia
(`/home/wesleyleandro/Projects/Desencoder/Tactia`), iniciada por outro agente.

Branch: `feat/refact-experience`. Nada foi enviado ao remoto. A modelagem,
serviços, telas, fila do Ops, editor de preparação, flag por empresa, revisão
guiada e eventos estão nesta branch.

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

Implemente a **próxima entrega de código** da Central de Comando: transformar os
eventos já persistidos em métricas operacionais consultáveis para acompanhar o
piloto. Não gaste esta etapa com uma nova rodada de revisão visual, pesquisa ou
deploy. O próximo desenvolvimento de produto, depois deste, é a revisão
semanal consolidada da entrega 4.

Requisitos:

- Parta de `packages/database/src/repositories/command-center-events.ts` e de
  `CommandCenterEvent` no schema Prisma. Já existem os eventos deduplicados
  `plan_created`, `decision_resolved`, `execution_state_changed`,
  `clarification_requested` e `clarification_received`. Não crie outro mecanismo
  de registro nem conte reprocessamentos como novos eventos.
- Crie uma leitura agregada por empresa e período, com limites de intervalo e
  consulta paginada quando houver detalhamento. Exponha-a em uma superfície
  operacional do Ops, com autorização de operador no servidor. Toda consulta e
  link de detalhe devem preservar o isolamento por tenant; um operador sem
  permissão não pode obter dados por URL direta.
- Comece por contagens e tendências que os eventos existentes sustentam.
  Separe plano criado, decisão resolvida, transição de execução e esclarecimento
  solicitado/recebido. Mostre período, definição e denominador quando calcular
  taxa. Ausência de eventos ou de cobertura deve aparecer como ausência, nunca
  como zero de desempenho ou sucesso comercial presumido.
- Não inclua texto de pergunta/resposta, telefone, nomes ou payloads de ações
  nas métricas, API, logs ou interface. Use apenas nomes de evento, estados,
  timestamps, IDs já autorizados e contagens necessárias. Não apresente métricas
  como tempo até primeiro valor, redução de esforço ou resultado comercial se
  os eventos atuais não permitem calculá-las; documente essa limitação.
- Reutilize componentes e padrões de Ops. Preserve o ciclo de execução,
  aprovação, medição e esclarecimento já implementado. Não altere a semântica
  de `recommendations/:id/accept` nem reexecute o seed em produção.
- Cubra, com testes relevantes, agregação, deduplicação, filtro temporal,
  isolamento entre empresas, autorização e estado vazio. Verifique typecheck e
  lint dos arquivos/pacotes alterados. Se precisar de migração, aplique-a apenas
  em `tactia_test` para a verificação; não modifique bancos de desenvolvimento
  ou produção sem confirmação do usuário.

Critério de saída: um operador consegue consultar, para uma empresa e janela
definidas, os indicadores sustentados pelos eventos da Central, entender o que
cada número mede e ver explicitamente o que ainda não pode ser inferido. A
consulta não expõe dados de outra empresa nem conteúdo pessoal.

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
  src/lib/__tests__/command-center-flag.test.ts \
  src/lib/__tests__/clarification-flow.test.ts \
  src/__tests__/pilot-flow.test.ts        # esperado: 34/34

cd packages/domain && pnpm exec vitest run \
  src/__tests__/command-center-service.test.ts \
  src/__tests__/evidence-clarification-policy.test.ts

cd apps/admin && DATABASE_URL=$TEST_DB pnpm exec vitest run \
  src/lib/__tests__/settings-routes.test.ts \
  src/lib/__tests__/tenant-tabs.test.ts       # esperado: 27/27

# typecheck dos 4 pacotes afetados
pnpm --filter @tactia/database typecheck && pnpm --filter @tactia/domain typecheck \
  && pnpm --filter @tactia/web typecheck && pnpm --filter @tactia/admin typecheck
```

Escreva testes para o comportamento agregado que adicionar. Rode as suítes
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
