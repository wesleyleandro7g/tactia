# Agente WhatsApp assíncrono

O mesmo agente do chat interno atende clientes pelo WhatsApp. Perguntas são
respondidas na hora; pedidos de **operação** (que alteram estado) são
confirmados imediatamente, executados em segundo plano e finalizados com uma
mensagem de status. Uma ação em andamento pode ser **cancelada** a qualquer
momento.

## Fluxo

```
Webhook Evolution → ACK 200 → after() → handleWhatsappInbound
  1. Cancelamento?  → cancela job ativo do número → "Ação cancelada."
  2. /nova          → inicia nova conversa
  3. Classifica read vs. operation
     - read       → orchestrator síncrono → responde
     - operation  → "Entendido! Vou fazer X e te retorno..." + enfileira job
  4. Worker (whatsapp.agent): running → orchestrator (escrita direta)
     → done + "Tudo feito! ..."   |   failed + aviso
```

- **Leitura vs. operação**: classificado por uma passada leve do LLM
  (`classifyWhatsappMessage`) com fallback por heurística de palavras‑chave, de
  modo que o webhook nunca trava por causa do classificador.
- **Execução direta**: no WhatsApp o número autorizado já é a autoridade, então
  as ferramentas de escrita executam direto (sem o gate de aprovação do chat
  web). O comportamento do chat web permanece inalterado.
- **Cancelamento cooperativo**: `handleWhatsappInbound` detecta a intenção de
  cancelar antes de qualquer processamento; se houver job ativo (`queued` ou
  `running`) o status é marcado como `cancelled`. O worker honra o cancelamento
  antes de persistir/notificar o sucesso. Uma mensagem normal enquanto um job
  roda **não** cancela — ela segue o fluxo normal.

## Estados do job (`whatsapp_agent_jobs`)

`queued → running → done` no caminho feliz. `cancelled` é alcançável a partir de
`queued`/`running`; `failed` registra o erro. `findActiveByNumber` retorna o job
em `queued`/`running` de um número (base do cancelamento).

## Fila

Usa a fila pg-boss existente (`JOBS.whatsappAgent = 'whatsapp.agent'`). Com
`JOBS_ENABLED=true` o worker registrado em `startJobWorkers` executa o job; sem
isso, `enqueueWhatsappAgentJob` roda inline (fire‑and‑forget) para manter o ACK
do webhook rápido — mesmo padrão dos demais jobs do app.

## Configuração por empresa

`whatsapp_agent_configs` (1 por empresa): **tom**, **instruções** de atendimento
e **contexto da empresa**. Injetados no system prompt como um bloco
`## Canal: WhatsApp` (via `WhatsappChannelContext`), presente apenas no canal
WhatsApp.

Telas:

- Produto: `/settings/whatsapp` (owner/admin) — card "Comunicação do agente".
- Ops: aba **WhatsApp** da empresa — mesmo card, escopo do operador.

## Tratamento por número

Cada número autorizado (`whatsapp_authorized_numbers`) ganhou **nome de
tratamento** (`contact_name`) e **cargo** (`contact_role`), usados no prompt
("Você está conversando com {nome}, {cargo}"). Configuráveis no cadastro do
número (produto e Ops).

## Fora de escopo

- **Múltiplas instâncias Evolution**: mantida a configuração single‑instance
  por variáveis de ambiente (`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`,
  `EVOLUTION_INSTANCE`, `EVOLUTION_WEBHOOK_SECRET`).

## Variáveis de ambiente

Nenhuma nova. Requer o LLM configurado (`LLM_API_KEY` ou `LLM_PROVIDER=mock`) e,
para execução em fila, `JOBS_ENABLED=true`. Opcional: `LLM_CLASSIFIER_MODEL`
para o modelo do classificador (cai para `LLM_MODEL`).
