# Plano — autonomia, progresso ao vivo e interrupção do Browser Agent

**Status:** T1–T8 implementadas e validadas localmente; T9 (validação ponta a ponta na Torge) pendente\
**Data:** 26/09/2026\
**Escopo:** Browser Agent interativo usado pelo chat da Tactia\
**Não altera:** o fluxo geral de aprovações das demais ações da plataforma

## 1. Objetivo

Eliminar aprovações intermediárias nas tarefas do Browser Agent e permitir que o usuário:

1. deixe o agente navegar e operar autonomamente;
2. acompanhe, no próprio chat, as ações executadas em tempo quase real;
3. interrompa a tarefa a qualquer momento;
4. receba uma explicação útil quando o agente detectar erro ou falta de progresso;
5. não precise aprovar repetidamente uma ação que entrou em loop.

## 2. Incidente que motivou esta etapa

Prompt observado:

> Acesse a página `https://app.torge.com.br/#/usuarios` do sistema da Torge e me diga quais são os usuários cadastrados.

O login foi concluído, mas o agente passou a solicitar repetidamente aprovação para clicar em um elemento com rótulo genérico. Os logs sanitizados mostraram esta sequência:

1. navegação até o login;
2. preenchimento de usuário e senha;
3. clique em `Conectar`;
4. autenticação concluída;
5. dois cliques de navegação;
6. repetição do mesmo `click` no alvo `@e1033`, sem avanço de URL, por várias execuções.

O loop tinha duas causas combinadas:

- qualquer clique era encaminhado para aprovação, inclusive cliques classificados como leitura;
- a proteção anterior cobria preenchimentos repetidos de credencial, mas não cliques consecutivos idênticos.

## 3. Decisões desta implementação

### 3.1 Browser Agent sem aprovação

Todas as ações executadas dentro de uma tarefa do Browser Agent serão autônomas, independentemente da categoria informada pelo modelo:

- `READ`;
- `WRITE`;
- `FINANCIAL`;
- `DESTRUCTIVE`;
- `EXTERNAL_COMMUNICATION`.

Essa decisão se aplica somente ao Browser Agent. Propostas e ações gerais da Tactia continuam usando o mecanismo normal de aprovação.

O controle humano passa a ser feito por observabilidade e interrupção:

```text
INICIAR TAREFA
      ↓
AGENTE OPERA AUTONOMAMENTE
      ↓
PROGRESSO VISÍVEL NO CHAT
      ↓
USUÁRIO PODE PARAR A QUALQUER MOMENTO
```

### 3.2 Proteção contra loops

O agente não deve executar consecutivamente a mesma ação sobre o mesmo alvo.

A identidade de uma ação considera:

- tipo;
- referência do elemento;
- campo de credencial;
- URL;
- valor, exceto valores provenientes do cofre.

`wait` e `scroll` não entram nessa deduplicação porque podem ser legitimamente repetidos.

Quando houver repetição:

1. a ação não será enviada novamente ao navegador;
2. o modelo receberá `SKIPPED_ALREADY_COMPLETED`;
3. será instruído a usar outro elemento, navegar diretamente para a URL do objetivo ou finalizar;
4. após três propostas repetidas, a tarefa será interrompida com erro específico de loop.

Quando o prompt contém uma URL explícita, o agente deve navegar diretamente até ela após autenticar, evitando procurar o mesmo destino repetidamente em menus.

### 3.3 Cancelamento cooperativo

O botão **Parar agente** não deve apenas alterar a interface. Ele precisa cancelar o estado durável da tarefa e ser respeitado pelo worker.

Fluxo alvo:

```text
Chat
  └─ POST /api/v1/browser/tasks/:id/cancel
       ├─ marca a tarefa como CANCELLED
       ├─ limpa ação/aprovação pendente legada
       └─ worker consulta o status
            ├─ interrompe antes da próxima decisão/ação
            ├─ fecha a sessão do navegador
            └─ persiste o storage state permitido
```

O worker deve consultar o status:

- antes de chamar o modelo;
- depois que o modelo responder;
- antes de executar uma ação no navegador;
- antes de gravar uma conclusão.

Se o cancelamento acontecer durante uma ação já iniciada, essa ação pode terminar, mas nenhuma ação seguinte deve ser executada.

### 3.4 Progresso ao vivo

O `GET /api/v1/browser/tasks/:id` passará a retornar um histórico sanitizado com, no máximo, as 50 ações mais recentes:

```json
{
  "progress": [
    {
      "id": "...",
      "actionType": "click",
      "status": "SUCCEEDED",
      "errorCode": null,
      "url": "https://app.exemplo.com/usuarios",
      "createdAt": "2026-09-26T13:11:00.000Z"
    }
  ]
}
```

O contrato não expõe:

- valores digitados;
- senhas;
- tokens;
- conteúdo descriptografado do cofre;
- seletores internos desnecessários.

No chat haverá um controle **Acompanhar ao vivo**. Quando ativado:

- o card consulta o status a cada 1 segundo enquanto a tarefa estiver ativa;
- as ações aparecem em ordem cronológica;
- o item mais recente recebe indicação de atividade;
- o usuário pode ocultar o histórico sem interromper a execução.

Com o acompanhamento fechado, permanece a consulta de estado a cada 3 segundos.

## 4. O que já foi concluído antes desta etapa

### 4.1 Infraestrutura e roteamento autônomo

- Browser Runtime Python isolado com Chromium.
- Gateway interno autenticado.
- Proxy de saída com allowlist por sessão.
- Fila durável para tarefas do navegador.
- Seleção autônoma das ferramentas de browser pelo agente.
- Perfis de sistemas com URL inicial, destinos permitidos e credencial vinculada.
- Persistência de sessão autenticada e artefatos.

### 4.2 Login e compatibilidade com a Torge

- Campos sem nome acessível recebem fallback por `name`, `id`, `autocomplete` e `type`.
- Preenchimentos provenientes do cofre não expõem o valor ao modelo ou aos logs.
- Destinos em portas alternativas precisam ser autorizados como `host:porta`.
- O perfil ERP Torge foi configurado com:
  - `app.torge.com.br`;
  - `api.torge.com.br:8443`.
- O acesso a `api.torge.com.br:8443` foi validado pelo próprio proxy restrito.

### 4.3 Skills do Browser Agent

- Skills globais por tenant.
- Skills específicas por perfil/sistema.
- Edição das skills pelo painel administrativo.
- Combinação das skills globais e locais no prompt operacional.

### 4.4 Diagnóstico e mensagens de erro

- Erros seguros são exibidos no card do Browser Agent.
- `BROWSER_RUNTIME_UNAUTHORIZED`, `NETWORK_BLOCKED`, `ELEMENT_NOT_FOUND` e limite de passos possuem mensagens amigáveis.
- Ações sobre elementos sem `target` são rejeitadas antes de chegar ao runtime.
- Resultados de ferramentas são devolvidos ao modelo como mensagens estruturadas.
- Preenchimentos de credencial duplicados são bloqueados.

### 4.5 Aprovação inline anterior

Foi implementado um Questionnaire do shadcn dentro do chat para aprovar ou rejeitar ações. Essa solução funcionou tecnicamente, mas será descontinuada para tarefas do Browser Agent por decisão desta etapa. O mecanismo geral de aprovação continuará disponível para outros tipos de ação.

## 5. Estado atual da implementação desta etapa

T1–T8 foram concluídas. Falta apenas a validação ponta a ponta na Torge (T9), que depende do ambiente real com Browser Runtime, proxy e credencial.

| Item | Estado | Onde |
| --- | --- | --- |
| Política sem aprovação | Concluído | `browserStepNeedsApproval` retorna `false`; o branch que criava `ActionExecution`/`Approval` foi removido de `BrowserAutomationService.run`. |
| Tarefas legadas em `WAITING_APPROVAL` | Concluído | Aprovar ou rejeitar uma aprovação antiga encerra a tarefa como `CANCELLED` com orientação para nova execução; ela nunca é retomada. O card mostra a nota "Execução antiga" e o botão Parar. |
| Anti-loop genérico | Concluído | `BrowserRepeatGuard` (`browser-agent-progress.ts`): a repetição não chega ao runtime, retorna `SKIPPED_ALREADY_COMPLETED` e aborta na 3ª proposta. `wait`/`scroll` são transparentes, então `click X → wait → click X` também é bloqueado. |
| Navegação direta para URL do objetivo | Concluído | Instrução no prompt operacional (`browserAgentSystemPrompt`). |
| Cancelamento durável | Concluído | `repo.cancelTask` (tenant + estados ativos) e `repo.finishTask` condicional a `RUNNING`: uma tarefa `CANCELLED` nunca vira `FAILED`/`COMPLETED`. |
| Checagens cooperativas | Concluído | Antes do modelo, depois do modelo, antes da ação e na gravação condicional da conclusão. A sessão é fechada no `finally` com persistência do storage state. |
| Endpoint de cancelamento | Concluído | `POST /api/v1/browser/tasks/:id/cancel`, idempotente para tarefas encerradas. |
| Contrato de progresso | Concluído | Até 50 ações em ordem cronológica, com `label` de interface e URL sem query string/fragmentos com parâmetros. Sem `actionInput`, valores ou seletores. |
| Permissão `canControl` | Concluído | `ChatScreen` (`hasMinRole(member)`) → `ChatShell` → `ChatPanel` → `MessageRow` → `BrowserTaskCard`. |
| UI Acompanhar ao vivo / Parar agente | Concluído | `Collapsible` com timeline `role="log"`, polling de 1 s (aberto) ou 3 s (fechado), botão destrutivo com spinner e atualização imediata para `CANCELLED`. |
| Remoção do Questionnaire do Browser Agent | Concluído | `BrowserApprovalQuestionnaire` removido do card; `components/ui/questionnaire.tsx` mantido. |
| Observabilidade | Parcial | Logs estruturados `browser_task_cancel_requested`, `browser_task_repeat_blocked` e `browser_task_finished` (outcome, passos, repetições bloqueadas, duração). Métricas/alertas da seção 9 ainda não foram criados. |

### 5.1 Validações executadas

- `pnpm --filter @tactia/web typecheck` e `pnpm --filter @tactia/database typecheck`: sem erros.
- Testes direcionados: `browser-automation-service.test.ts` (worker e cancelamento com dependências simuladas), `browser-automation-policy.test.ts`, `browser-task-ui.test.ts`, `browser-task-cancel-route.test.ts` e `browser-automation-repository.test.ts` — todos passando.
- ESLint: nenhum erro nos arquivos desta etapa. Os 2 erros restantes do Web estão em `components/landing/*`, fora do escopo.
- `git diff --check`: sem problemas.
- Suítes completas: as falhas restantes são pré-existentes e fora do escopo (`browser-dynamic-config.test.ts`: FK de fixture; `mcp-oauth-flow.test.ts`: segredo JWKS do banco de teste). O banco de teste local precisou de `prisma migrate deploy` para a migration `20260926123000_browser_agent_skills`.

### 5.2 Limitações conhecidas

- O "teste do card" cobre as regras puras de polling e visibilidade do botão (`browser-task-ui.ts`). Não existe ambiente DOM (jsdom/Testing Library) no projeto para testar a renderização do componente.
- Uma ação já enviada ao runtime quando o usuário clica em Parar pode terminar; nenhuma ação seguinte é executada.

## 6. Próximas tarefas

### T1 — estabilizar o código parcial

**Prioridade:** P0\
**Dependências:** nenhuma

- revisar os patches parciais;
- corrigir tipos Prisma do cancelamento;
- formatar o bloco de tratamento de `BrowserTaskStopped`;
- confirmar que uma tarefa cancelada nunca é sobrescrita como `FAILED` ou `COMPLETED`;
- executar typecheck antes de continuar a UI.

**Critério de aceite:** Web e Database compilam sem erro e nenhum teste existente regride.

### T2 — finalizar execução sem aprovação

**Prioridade:** P0\
**Dependências:** T1

- manter `browserStepNeedsApproval` retornando `false` para todas as ações do Browser Agent;
- remover ou tornar inacessível o branch que cria `ActionExecution`/`Approval` para ações do navegador;
- atualizar registros existentes de `browser_action` para `requiresApproval=false`, se necessário;
- preservar aprovações de ações não relacionadas ao navegador;
- definir tratamento para tarefas antigas em `WAITING_APPROVAL`: cancelar e solicitar nova execução.

**Critério de aceite:** nenhuma nova tarefa do Browser Agent entra em `WAITING_APPROVAL`.

### T3 — concluir a proteção genérica contra loops

**Prioridade:** P0\
**Dependências:** T1

- impedir a execução consecutiva do mesmo fingerprint;
- retornar resultado estruturado para a tentativa ignorada;
- zerar o contador quando uma ação diferente progride;
- permitir repetição de `wait` e `scroll`;
- adicionar erro específico após três repetições;
- testar o caso real do alvo genérico `@e1033`.

**Critério de aceite:** o mesmo clique não é enviado duas vezes consecutivas ao runtime e o modelo escolhe outro caminho ou encerra.

### T4 — finalizar o cancelamento cooperativo

**Prioridade:** P0\
**Dependências:** T1

- validar `BrowserAutomationRepository.cancelTask` com escopo de tenant e estados ativos;
- concluir `BrowserAutomationService.cancelTask`;
- rejeitar/encerrar uma aprovação legada pendente sem bloquear o cancelamento;
- checar cancelamento nos quatro pontos do worker;
- fechar a sessão ativa no `finally`;
- tornar o endpoint idempotente para tarefas já encerradas.

**Critério de aceite:** após clicar em **Parar agente**, nenhuma nova ação é registrada e o status final permanece `CANCELLED`.

### T5 — finalizar o contrato de progresso

**Prioridade:** P1\
**Dependências:** T1

- confirmar ordenação cronológica;
- limitar a 50 ações;
- mapear nomes de ação para rótulos de interface;
- garantir que `actionInput`, credenciais e seletores não sejam retornados;
- adicionar teste de serialização segura.

**Critério de aceite:** o cliente recebe apenas metadados sanitizados e suficientes para explicar o progresso.

### T6 — implementar os controles no chat

**Prioridade:** P1\
**Dependências:** T4 e T5

- adicionar permissão `canControl` para membros, admins e owners;
- adicionar botão shadcn **Acompanhar ao vivo**;
- usar o `Collapsible` já instalado para mostrar/ocultar a timeline;
- adicionar botão shadcn destrutivo **Parar agente**;
- exibir spinner e desabilitar o botão durante o cancelamento;
- atualizar o card imediatamente para `CANCELLED` após sucesso;
- manter mensagens acessíveis com `aria-live` e `role="log"`;
- substituir a UI de aprovação do Browser Agent por uma nota para tarefas legadas.

**Critério de aceite:** o usuário acompanha ações e interrompe uma tarefa sem sair do chat.

### T7 — remover o fluxo visual de aprovação do Browser Agent

**Prioridade:** P1\
**Dependências:** T2 e T6

- remover `BrowserApprovalQuestionnaire` do card;
- remover imports e estados sem uso;
- manter o componente `questionnaire.tsx` disponível caso seja usado por outros fluxos;
- garantir que os cards gerais de aprovação continuem funcionando.

**Critério de aceite:** nenhuma pergunta “Aprovar a próxima ação do Browser Agent?” é exibida em novas tarefas.

### T8 — testes automatizados

**Prioridade:** P0\
**Dependências:** T2–T7

Adicionar ou atualizar:

- teste de política: todas as categorias do Browser Agent retornam sem aprovação;
- teste de fingerprint: categorias/reasons diferentes não mascaram repetição da mesma ação;
- teste de loop: segundo clique idêntico é ignorado;
- teste de cancelamento tenant-scoped;
- teste de cancelamento durante `RUNNING`;
- teste de cancelamento durante chamada ao modelo;
- teste de terminalidade: `CANCELLED` não vira `FAILED`/`COMPLETED`;
- teste do contrato público de progresso;
- teste de ausência de segredos;
- teste da rota de cancelamento;
- teste do card: toggle ao vivo, polling e botão de parada.

**Critério de aceite:** testes direcionados, typecheck, ESLint e `git diff --check` passam.

### T9 — validação ponta a ponta na Torge

**Prioridade:** P0\
**Dependências:** T8

Executar novamente:

> Acesse a página `https://app.torge.com.br/#/usuarios` do sistema da Torge e me diga quais são os usuários cadastrados.

Verificar:

1. login sem aprovação;
2. navegação direta até `#/usuarios`;
3. ausência de cliques consecutivos idênticos;
4. timeline atualizada durante a execução;
5. resposta final contendo os usuários observados;
6. uma segunda execução interrompida manualmente pelo botão;
7. nenhuma credencial presente em resposta, logs ou payload público.

**Critério de aceite:** uma execução conclui autonomamente e outra pode ser cancelada sem ação posterior.

## 7. Ordem recomendada

```text
T1 Estabilização
 ├─ T2 Sem aprovação
 ├─ T3 Anti-loop
 ├─ T4 Cancelamento
 └─ T5 Progresso
       ↓
T6 Interface no chat
       ↓
T7 Limpeza da aprovação antiga
       ↓
T8 Testes
       ↓
T9 Validação Torge
```

## 8. Matriz de estados da interface

| Status | Acompanhar ao vivo | Parar agente | Mensagem esperada |
| --- | --- | --- | --- |
| `QUEUED` | disponível | disponível | Aguardando início |
| `RUNNING` | disponível | disponível | Ação atual e contador |
| `WAITING_APPROVAL` legado | disponível | disponível | Execução antiga; interrompa e inicie novamente |
| `COMPLETED` | histórico disponível | oculto | Resultado e artefatos |
| `FAILED` | histórico disponível | oculto | Erro seguro e última ação |
| `CANCELLED` | histórico disponível | oculto | Interrompida pelo usuário |

## 9. Observabilidade e métricas recomendadas

Registrar sem dados sensíveis:

- duração total da tarefa;
- quantidade de ações;
- quantidade de ações repetidas bloqueadas;
- cancelamentos solicitados;
- tempo entre solicitação e interrupção efetiva;
- erros por código;
- tarefas que atingem o limite de passos;
- tarefas que terminam com `success=false` após mensagem observada na página.

Alertas sugeridos:

- mais de 5% das tarefas atingindo limite de passos;
- três ou mais loops bloqueados no mesmo perfil em uma hora;
- cancelamento levando mais de 10 segundos para ser respeitado;
- crescimento de `ELEMENT_NOT_FOUND` por perfil.

## 10. Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Ações destrutivas sem aprovação | Botão de parada, timeline, allowlist de destinos, logs auditáveis e skills por perfil. |
| Cancelamento durante ação externa | Cancelamento cooperativo impede ações seguintes; a ação já enviada pode concluir. |
| Polling excessivo | 1 segundo somente com acompanhamento aberto; 3 segundos no modo compacto. |
| Vazamento de credencial no progresso | Contrato público não inclui `actionInput` nem valores. |
| Loop alternando dois elementos | Evolução futura para detectar ciclos A→B→A, além da repetição consecutiva. |
| Tarefa antiga presa em aprovação | Exibir opção de parar e solicitar nova execução. |

## 11. Próximas evoluções após esta entrega

Estas tarefas não bloqueiam a entrega inicial:

1. substituir polling por Server-Sent Events;
2. detectar ciclos de múltiplas ações, como A→B→A;
3. adicionar política configurável por tenant: autônomo, somente leitura ou aprovação completa;
4. exibir miniaturas opcionais de screenshots intermediários;
5. permitir adicionar uma skill diretamente a partir de um erro observado;
6. mostrar domínio e rota atuais sem expor query strings sensíveis;
7. adicionar orçamento configurável de tempo, passos e tokens por perfil;
8. adicionar botão para repetir uma tarefa concluída ou falha;
9. criar painel operacional de tarefas ativas e cancelamentos.

## 12. Definition of Done

A implementação estará concluída quando:

- nenhuma nova tarefa do Browser Agent solicitar aprovação;
- o caso `#/usuarios` não repetir consecutivamente o mesmo clique;
- o progresso puder ser aberto e acompanhado no chat;
- o botão de parada funcionar em `QUEUED`, `RUNNING` e estado legado de aprovação;
- o worker respeitar o cancelamento antes de qualquer nova ação;
- tarefas canceladas permanecerem `CANCELLED`;
- nenhuma credencial ou valor secreto aparecer no contrato público;
- testes direcionados, typecheck, lint e smoke test passarem;
- o fluxo real da Torge for validado de ponta a ponta.
