# Automações personalizadas

Cada automação publicada é um recurso da empresa: definição versionada, execuções duráveis e uma página própria.

A equipe Tactia cria e publica. O cliente configura os parâmetros liberados, dispara e acompanha. Começa desligada (`tenants.automations_enabled = false`) e só deve ser ligada no tenant de demonstração até a validação com um cliente real.

## Como ligar

No Tactia Ops, aba **Automações** da empresa:

1. Habilitar a empresa.
2. Criar o rascunho do piloto de relatórios.
3. Importar o workflow `tactia.reports-portal` v1 e publicar a revisão.
4. Preparar a versão (conexão e destinatário pré-autorizado) e publicar.

O script `apps/web/scripts/seed-automations-demo.ts` faz isso para um tenant informado em `AUTOMATIONS_DEMO_TENANT_ID`.

A execução automática exige `JOBS_ENABLED=true` no app web. Sem workers, um disparo feito na página ainda segue em processo, mas o modo operacional é a fila.

## Piloto

Portal isolado em `/demo/reports-portal` (senha `DEMO_REPORTS_PORTAL_PASSWORD`, ou `demo-reports` fora de produção). Entrega três CSVs fictícios: vendas, estoque e financeiro.

O workflow Figranium publicado está em `packages/connectors/src/browser/engines/figranium/workflows/reports-portal.v1.json`. A execução fixa a revisão usada na publicação e coleta os CSVs pelo BrowserExecutor. Sem a instância Figranium dedicada à conexão, a etapa falha. A geração local dos mesmos arquivos existe só como fixture de teste e não conta como execução bem-sucedida.

## Canais

Página, agente (`list_automations`, `get_automation`, `run_automation`, `get_automation_run`), agendamento (`target=automation`), webhook com HMAC e o evento `sync.completed`. O evento só é gravado quando a sincronização termina por completo; falha ou resultado parcial não disparam.

O agendamento só conta sucesso quando a automação termina com sucesso. Enfileirar ou esperar aprovação não conclui a ocorrência. `effectMode=propose` pode exigir aprovação extra e não amplia os destinatários publicados.

## E-mail e aprovação

Destinatário pré-autorizado segue direto quando o modo permite. Destinatário na lista de aprovação pausa a execução. Fora das duas listas, a etapa é rejeitada. Ações de e-mail em `pending`, `approved` ou `running` continuam em andamento; a etapa só conclui depois do resultado confirmado. Sucesso de envio é a aceitação SMTP com identificador. Resultado incerto fica em **Requer atenção**. Admin ou owner reconcilia com **envio confirmado** (não reenvia) ou **envio não ocorrido** (nova tentativa com outra chave de idempotência). A decisão fica registrada na etapa.

## Recuperação

O disparo grava a execução e uma mensagem de outbox na mesma transação. O worker retoma da etapa incompleta, não repete etapa já confirmada e só tenta de novo operações marcadas como seguras.
