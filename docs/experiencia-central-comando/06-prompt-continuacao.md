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

Conclua o **próximo passo 1** de `05-status-implementacao.md`: validação
renderizada e de acessibilidade da Central de Comando e do editor do Ops em
360, 768 e 1280px, nos temas claro e escuro. A revisão estática já corrigiu
contrastes de tokens, quebra de cards e foco nos erros; os gráficos existentes
já oferecem tabela acessível em `<details>`. Nesta sessão o navegador não
estava disponível, portanto não marque WCAG/visual como concluídos sem nova
evidência.

Requisitos:

- Verifique em navegador foco, teclado, zoom, contraste renderizado, leitura de
  estados e ausência de truncamento em decisões e resultados; registre evidência
  reproduzível e corrija os problemas encontrados.
- Preserve os contratos de confiança, tenant, versão e snapshot existentes.
- O editor em `/tenants/[id]/preparation` já publica plano e medição sem
  recomendação; não duplique essa implementação.

Se concluir, avance para a consolidação de métricas de eventos sem conteúdo de
mensagens ou PII, o próximo passo 2 do documento de status.

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

O banco de teste já tem as 7 migrações aplicadas. **Nunca aponte migração para o
banco de desenvolvimento ou produção sem pedir confirmação ao usuário.**

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

Escreva teste novo para o comportamento que você adicionar, e rode as suítes
acima como regressão.

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
