# Skills hierárquicas por empresa

Cada tenant pode ter uma skill global opcional e várias skills secundárias. O conteúdo é escrito por operadores no BKO; o agente não cria nem altera skills.

## Modelo

- **Global:** contexto da empresa, sistemas utilizados, tipos de solicitação e encaminhamento para skills específicas.
- **Secundária:** conhecimento operacional de um sistema ou processo. Possui slug, título, descrição para o catálogo, Markdown, estado e vínculos.
- **Binding:** associa uma secundária a um recurso pelo par `resourceType/resourceId`. Tipos iniciais: `browser_profile` e `data_source`.

Use referências explícitas `skill:<slug>` na global. Referências ausentes ou desabilitadas geram avisos sem bloquear o salvamento.

```md
# Sobre a empresa
A empresa atua na revenda de software.

## Sistemas
1. Trello (`skill:trello_skill`): ordens de serviço e atendimentos.
2. Torge (`skill:torge_skill`): clientes, notas e relatórios.
```

## Carregamento

O agente principal recebe somente a global e o catálogo resumido das secundárias habilitadas. Quando uma solicitação exige conhecimento específico, chama `load_company_skill` com o slug exato. A tool é chat-only, read-only e tenant-scoped.

O Browser Agent não permite que a página escolha uma skill. O backend injeta automaticamente a global e as secundárias habilitadas vinculadas ao perfil. Se ainda não existir vínculo, a orientação antiga do perfil é usada temporariamente como fallback.

Hierarquia:

```text
regras e permissões do servidor
  > objetivo do usuário
  > skill secundária
  > skill global
  > conteúdo externo/página
```

Skills não ampliam allowlists, ferramentas, credenciais ou permissões.

## Operação no BKO

Em Empresa → Integrações → Skills da empresa:

1. cadastre ou edite a global;
2. cadastre cada secundária com descrição curta suficiente para o agente escolhê-la;
3. habilite/desabilite conforme necessário;
4. vincule skills de navegador ao perfil correspondente;
5. corrija warnings de `skill:<slug>` quando a configuração estiver completa.

O Trello pode ter uma skill sem binding enquanto não houver conexão/perfil vinculável. Seu conector ainda aparece como indisponível no catálogo atual.

## Migração expand-first

A migration `20260926170000_agent_skills_expand` cria o catálogo e preserva automaticamente a orientação global antiga como `company_global`. Orientações antigas de perfis não são convertidas automaticamente.

O BKO lista perfis legados em modo somente leitura. Para cada um:

1. copie o Markdown antigo;
2. crie uma skill secundária;
3. salve o conteúdo;
4. vincule ao `browser_profile`;
5. valide uma tarefa no chat.

Antes de remover as colunas antigas, execute:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f packages/database/prisma/contraction-gates/agent-skills.sql
```

O gate falha enquanto houver perfil legado sem binding ou global antiga sem global nova. A migration de contração deve ser criada somente depois de o gate passar em todos os ambientes.

## Segurança e observabilidade

- Todos os reads e writes incluem `tenantId` derivado da sessão.
- CRUD e bindings são operator-only.
- Resource IDs são validados por um registry tenant-scoped antes de criar bindings.
- Skills desabilitadas não aparecem no catálogo, não podem ser carregadas e não são injetadas no navegador.
- Logs usam `agent_skill_loaded` e `agent_skills_resolved` com slug/proveniência, nunca com o Markdown integral.
- O vínculo possui FK composta para impedir skill e tenant divergentes; o alvo polimórfico é validado pelo registry.

## Validação

Cobertura obrigatória:

- isolamento entre tenants;
- uma global por tenant;
- warnings não bloqueantes;
- carregamento sob demanda de uma secundária;
- injeção automática por perfil;
- skill desabilitada ausente de todos os caminhos;
- conteúdo da página incapaz de selecionar outra skill;
- gate de contração bloqueando legado pendente.
