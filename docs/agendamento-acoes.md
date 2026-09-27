# Agendamento de ações por empresa

Agendamentos disparam, de forma recorrente ou pontual, **o agente de IA** ou **uma ação do catálogo** para uma empresa. São geridos pelo Tactia Ops (backoffice) e também podem ser criados pelo próprio usuário no chat.

## Conceitos

- **Schedule** (`schedules`): a definição do agendamento (alvo, recorrência, repetição, payload).
- **ScheduleOccurrence** (`schedule_occurrences`): cada disparo de um período. Uma ocorrência por período (`periodKey`), garantindo idempotência.

Cada empresa pode ter múltiplos agendamentos.

## Alvos (`target`)

| Alvo | O que faz | Payload |
|---|---|---|
| `ai_agent` | Roda o agente de IA headless com as instruções do agendamento. | `aiConfig`: `{ instruction, systemPrompt?, tools?, skillIds? }` |
| `action` | Propõe/executa uma ação do catálogo (ex.: `send_email`). | `actionType` + `actionInput` |
| `automation` | Placeholder mapeado — ainda **não** suportado (falha com mensagem clara). | — |

## Modo de efeito (`effectMode`)

Controla o que acontece quando o disparo produz um efeito colateral:

- `propose` (padrão): o efeito vira uma **proposta pendente de aprovação** (`/approvals`). A IA nunca causa efeito sozinha.
- `auto_execute`: executa **sem aprovação** — o responsável configurou o agendamento e confia nele.

Para `ai_agent`, o `effectMode` governa as ações que o agente propõe durante a execução.

## Recorrência (modelo híbrido)

Enum `frequency` + `recurrenceConfig` (JSON) cobrem os casos comuns; `cronExpression` cobre o trigger custom; `manual` só dispara sob demanda.

| `frequency` | Regra | `recurrenceConfig` | `periodKey` |
|---|---|---|---|
| `daily` | Todo dia, no/após `localTime`. | `{ localTime }` | `YYYY-MM-DD` |
| `weekly` | Nos dias da semana escolhidos. | `{ weekdays:[0-6], localTime }` (0=Dom) | `YYYY-Www` (ISO) |
| `monthly` | Dia do mês OU N-ésimo dia útil. | `{ dayOfMonth }` ou `{ nthBusinessDay }` + `localTime` | `YYYY-MM` |
| `custom` | Cron. | — (usa `cronExpression`) | `YYYY-MM-DDTHH:mm` |
| `manual` | Nunca dispara automaticamente. | — | `manual:<iso>:<rand>` |

Notas:
- `dayOfMonth` é **clampado** ao tamanho do mês (dia 31 dispara no 28/30 quando não existe).
- `nthBusinessDay` conta apenas segunda–sexta (ex.: "5º dia útil").
- Todos os horários são avaliados no **timezone do agendamento** (ou o da empresa, padrão `America/Sao_Paulo`).

## Repetição (`repeatMode`)

- `infinite`: dispara indefinidamente.
- `count`: desativa após `maxOccurrences` **ocorrências concluídas com sucesso**. Falhas **não** contam.

## Resiliência

- **Idempotência por ocorrência (§5.1):** cada período tem uma única `ScheduleOccurrence` (`unique (tenant, schedule, periodKey)`). Um tick repetido não recria a ocorrência; um run só executa ocorrências `pending` — uma ocorrência `completed` nunca é repetida.
- **Falha não conta:** em erro, a ocorrência fica `failed` e o `successCount` não avança. Para `action` com `auto_execute`, se a execução subjacente falhar, a ocorrência falha (não é marcada como sucesso).
- **Reset (§5.2):** apagar a ocorrência de um período (via UI/serviço) é a **única** forma sancionada de reexecutar trabalho já concluído. O próximo tick (ou disparo manual) cria uma nova ocorrência para aquele período.

## Como roda

1. `schedule.tick` (a cada 5 min) chama `ScheduleService.enqueueDueSchedules(now)`.
2. Para cada agendamento habilitado, não-`manual`, com orçamento e **due** no timezone, cria uma ocorrência exclusiva e publica `schedule.run` (`singletonKey = occurrenceId`).
3. O worker `schedule.run` chama `ScheduleRunner.run(tenantId, occurrenceId)`, que resolve o `target` e registra o resultado na ocorrência.
4. Disparo **manual** cria uma ocorrência `manual:<...>` e a enfileira imediatamente.

No backoffice (que não registra o worker pg-boss), o disparo manual roda a ocorrência **inline**.

## Gestão no backoffice (Tactia Ops)

Aba **Agendamentos** em cada empresa (`/tenants/{id}/schedules`): criar, listar, disparar agora, desativar/reativar e remover. Endpoints sob `/api/v1/tenants/{id}/schedules`:

| Método | Rota | Ação |
|---|---|---|
| GET | `/schedules` | Lista |
| POST | `/schedules` | Cria |
| PATCH | `/schedules/{scheduleId}` | Atualiza |
| DELETE | `/schedules/{scheduleId}` | Remove |
| POST | `/schedules/{scheduleId}/enabled` | Ativa/desativa (`{ enabled }`) |
| POST | `/schedules/{scheduleId}/trigger` | Dispara agora |
| POST | `/schedules/{scheduleId}/reset` | Reset de um período (`{ periodKey }`) |
| GET | `/schedules/{scheduleId}/occurrences` | Histórico de ocorrências |

## Agendamento pelo chat

O usuário pode pedir ao agente para gerenciar agendamentos. As ferramentas (chat-only, fora do MCP):

| Ferramenta | Papel mínimo | Descrição |
|---|---|---|
| `create_schedule` | admin | Cria um agendamento. O agente confirma o resumo (o quê, quando, repetição) antes de criar. |
| `list_schedules` | member | Lista os agendamentos da empresa. |
| `update_schedule` | admin | Atualiza campos (informe `scheduleId`). |
| `disable_schedule` | admin | Desativa/reativa. |
| `trigger_schedule` | admin | Dispara agora. |

A criação pelo chat é **direta** (self-service): um agendamento é configuração, não um efeito colateral externo. Qualquer efeito futuro continua governado pelo `effectMode` do próprio agendamento.

Exemplos de frases:

- "Crie um agendamento diário às 8h que rode o agente para gerar o briefing."
- "Agende um e-mail toda segunda 9h para dono@empresa.com."
- "Liste meus agendamentos."
- "Desative o agendamento X." / "Rode agora o agendamento X."

## Auditoria

Cada operação registra um `AuditLog` (`SCHEDULE_CREATED/UPDATED/DELETED/ENABLED/DISABLED/TRIGGERED/RESET`, `SCHEDULE_OCCURRENCE_COMPLETED/FAILED`) com `actorType` `operator` (backoffice), `ai` (chat) ou `system` (execução).
