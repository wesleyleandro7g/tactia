# Esclarecimento pontual de lacunas (Fluxo D)

Quando uma evidência necessária não existe em nenhuma fonte conectada, a Tactia
pode fazer **uma pergunta curta** à pessoa que detém o fato, no canal que ela já
usa (WhatsApp). Isso não cria rotina de reporte: o cliente nunca precisa
preencher formulário, fazer check-in nem repetir a resposta no app.

## Ordem obrigatória

1. Consultar fontes conectadas e contexto autorizado.
2. Reconciliar no Ops (`/gaps`) quando o problema é técnico.
3. Só então perguntar à pessoa, dentro da política de contato.

O envio revalida a lacuna e a política no momento do disparo. Se o dado chegou
antes, a pergunta é **cancelada** em vez de incomodar a pessoa.

## Política por empresa (opt-in)

Em `whatsapp_agent_configs`, desativada por padrão:

| Campo | Efeito |
|---|---|
| `clarifications_enabled` | Habilita consultas proativas. Sem isso, nada é enviado |
| `clarification_start_hour` / `clarification_end_hour` | Janela de horário local da empresa |
| `clarification_weekdays` | Dias permitidos (0 = domingo) |
| `clarification_max_per_day` | Máximo de perguntas por pessoa em 24h |
| `clarification_cooldown_hours` | Intervalo mínimo desde o último contato à mesma pessoa |

## Fluxo

```text
Ops prepara (numberId + pergunta)  →  evidence_clarifications.status = queued
   ↓ tick do agendador ou POST /api/v1/clarifications/dispatch
worker revalida lacuna + política
   ├─ lacuna já resolvida        → cancelled (ninguém é contatado)
   ├─ fora da política/orçamento → failed com o motivo (ninguém é contatado)
   └─ permitido                  → envia e marca sent
   ↓ resposta no WhatsApp
resposta clara    → OperationalEvidence(reported) + lacuna resolvida
resposta ambígua  → OperationalEvidence(reported) + lacuna em tratamento
silêncio          → permanece sem confirmação
```

## Garantias

- **Identidade**: só números autorizados com membership ativa; a resposta é
  atribuída à pessoa daquele número.
- **Uma pergunta por lacuna**: `unique(gap_id)`. Preparar de novo devolve a
  mesma consulta em vez de duplicar a cobrança.
- **Sem processamento duplicado**: `unique(response_message_id)` e o dedupe de
  inbound por `last_inbound_message_id`.
- **Silêncio não confirma**: a lacuna só é resolvida com resposta clara.
  Hesitação (“não sei”, “vou verificar”, “talvez”) é registrada como relato sem
  confirmação.
- **Sem executor paralelo**: o envio usa o adapter Evolution já existente em
  `apps/web`; o Ops apenas prepara.
- **Resposta não autoriza ação**: o esclarecimento é interceptado antes do
  agente, então responder uma pergunta de status nunca dispara outra operação.

## Onde operar

- **Ops → Lacunas** (`/gaps`): coluna **Esclarecimento** mostra estado, contato,
  horário de envio e erro. O botão **Preparar consulta** cria a pergunta e move a
  lacuna para “aguardando resposta”.
- Nenhum controle aparece para empresas sem número autorizado ou sem opt-in: a
  tentativa retorna o motivo em vez de enviar.

## Entrega

`POST /api/v1/clarifications/dispatch` (header `x-cron-secret`) em `apps/web`
enfileira o que o Ops preparou. Com `JOBS_ENABLED=true` o job
`evidence.clarification` roda na fila; sem isso, executa inline. O tick de 5
minutos também varre consultas preparadas.

## Fora de escopo nesta entrega

- Agrupar várias lacunas em uma única mensagem.
- Reenvio automático após silêncio (hoje a lacuna volta ao Ops).
- Classificação da resposta por LLM: a distinção clara/ambígua é heurística e
  determinística, e nunca converte hesitação em confirmação.
