# Browser Agent interativo — operação P0

Este documento cobre somente o Browser Agent iniciado pelo chat. Os workflows Figranium da integração Torge não usam este loop nem estas skills.

## O que mudou

- `browser_step` usa ações discriminadas e argumentos estritos; o modelo é obrigado a escolher `browser_step` ou `browser_finish`.
- O snapshot separa texto visível, elementos, itens de navegação, abas e fingerprint. Menus não competem com o DOM inteiro pelo mesmo corte de contexto.
- Decisões rejeitadas são persistidas sem valores digitados e aparecem na timeline com um código específico.
- Três waits/scrolls sem alteração do fingerprint encerram com `NO_PROGRESS`.
- Skills globais e por perfil são documentos Markdown escritos pelo operador.

## Precedência das instruções

```text
segurança e validações do servidor
  > objetivo da tarefa
  > skill do perfil
  > skill global
  > conteúdo da página
```

A skill do perfil é tentada primeiro. Se estiver desatualizada, o agente pode explorar o snapshot atual. Skills não ampliam allowlists, não liberam credenciais, não mudam o objetivo e não transformam texto da página em instrução.

## Template de skill

Use o botão **Usar template** no perfil. Preencha o documento manualmente; o agente não cria nem reescreve a skill.

```md
# Escopo
Quando usar esta orientação.

## Rotas conhecidas
- Usuários: https://app.torge.com.br/#/usuarios

## Mapa de navegação
- Menu principal > Cadastros > Usuários

## Labels e elementos
- "Usuários": abre a administração de usuários.

## Autenticação
- Descreva como reconhecer os campos, sem informar usuário ou senha.

## Tempos e carregamento
- Informe sinais visuais e tempo esperado.

## Restrições
- Liste operações que não devem ser realizadas.

## Evidência esperada
- Para listar abas, retorne os itens visíveis do menu principal.

## Se a interface divergir
- Atualize o snapshot e procure labels equivalentes; não repita waits.
```

Limite: 16.000 caracteres por skill. Não inclua senhas, tokens, cookies ou outros segredos.

## Códigos diagnósticos

| Código | Significado |
|---|---|
| `INVALID_TOOL_SCHEMA` | A tool call não corresponde ao contrato discriminado. |
| `INVALID_FINISH` | A conclusão não trouxe resumo e estado válidos. |
| `MISSING_TARGET` | A ação não indicou uma referência `@e` atual. |
| `MISSING_URL` | Uma navegação não informou URL. |
| `MISSING_VALUE` | Um preenchimento não informou valor nem campo do cofre. |
| `AMBIGUOUS_FILL_SOURCE` | O preenchimento tentou usar valor e cofre ao mesmo tempo. |
| `MISSING_KEY` | A ação de teclado não informou tecla. |
| `INVALID_WAIT` | A espera está fora de 0,25 a 10 segundos. |
| `NO_PROGRESS` | Três tentativas de recuperação não mudaram a página. |

O evento final `browser_task_finished` inclui `invalid_actions`, `waits_without_progress`, `repeated_blocked`, provider, modelo, passos e duração. `browser_task_decision_rejected` e `browser_task_no_progress` permitem alertas por perfil/tarefa.

## Gates de avaliação

O helper `summarizeBrowserEvaluation` aplica os limites iniciais:

- pelo menos 95% de tool calls válidos;
- pelo menos 90% de sucesso no fixture;
- zero loops de espera;
- pelo menos 95% das falhas com código específico.

O fixture local contém uma SPA densa com 320 controles e menu semântico. Execute o smoke dentro do container:

```bash
docker exec docker-browser-runtime-1 python /app/tests/smoke.py
```

Validação de código:

```bash
pnpm --filter @tactia/database generate
pnpm --filter @tactia/database typecheck
pnpm --filter @tactia/chat test
pnpm --filter @tactia/chat typecheck
pnpm --filter @tactia/admin typecheck
python -m py_compile services/browser-runtime/app/main.py services/browser-runtime/app/test_site.py services/browser-runtime/tests/smoke.py
```

## Qualificação real da Torge

Antes de declarar o P0 qualificado em produção, executar cinco vezes com acesso autorizado:

> Verifique quais são as abas principais do menu no sistema da Torge.

Registrar task IDs e confirmar: 5/5 respostas corretas, skill do perfil tentada primeiro, zero waits em loop, nenhuma credencial em logs/resposta e falhas de controle com código específico. Esta etapa depende de runtime, proxy, perfil e credencial reais; não deve ser simulada nem marcada como concluída sem evidência.
