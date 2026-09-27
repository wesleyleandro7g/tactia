# Arquitetura de integrações por navegador

Status: decisão de implementação em 21/09/2026.

## Responsabilidades e reaproveitamento

| Camada | Responsabilidade | Implementação Tactia |
| --- | --- | --- |
| Provedor | Semântica, módulos, identidade, parser e completude | `packages/connectors/src/providers/torge` |
| Mecanismo | Aquisição por navegador | contratos em `packages/connectors/src/browser` |
| Executor | Tradução do contrato para uma ferramenta | adaptador Figranium em `browser/engines/figranium` |
| Execução | fila, exclusão concorrente, tentativas e retomada | `pg-boss` já existente; `SyncJob` agregado e `IntegrationModuleRun` por módulo |
| Pipeline | raw, normalização, qualidade e publicação canônica | `SyncService`, `RawRecord`, `Import` e repositórios existentes |
| Segredos | credenciais da origem | `CredentialService`, AES-256-GCM e escopo de tenant existentes |
| Artefatos | arquivos controlados pela Tactia | `ObjectStorage` existente e metadados em `IntegrationArtifact` |
| Operação | cadastro, teste, habilitação e acompanhamento | tela de fonte existente no BKO, somente operador |

Não é criado outro worker, broker ou agendador. O `apps/web` continua hospedando os workers long-lived e o tick do `pg-boss`; o BKO apenas cria solicitações duráveis. O agendamento interno das tarefas Figranium permanece desabilitado.

## Fluxo

1. O operador cria uma fonte `torge` em estado `draft`. A credencial é gravada separadamente e nunca retornada.
2. Configuração válida, vínculo de fluxos publicados e qualificação de isolamento permitem habilitar a conexão.
3. O tick horário existente identifica conexões Torge vencidas no fuso/horário configurados e publica um único `sync.execute` por conexão e data local.
4. `SyncService` cria/retoma um `SyncJob`; módulos são executados serialmente para não disputar a sessão/filial.
5. Cada módulo ganha um `IntegrationModuleRun`. O conector chama o executor, valida a saída e grava `RawRecord` idempotente.
6. O pipeline existente normaliza, valida e publica no modelo canônico. Checkpoint e `lastSyncAt` só avançam após publicação válida.
7. Falhas são isoladas por módulo. O agregado termina em `completed`, `partial`, `failed`, `cancelled` ou `needs_attention`.

## Figranium fixado

- Release: `v0.18.4`
- Commit: `efdd123c5d1bd49cfbae4c56c0e7f01eb9c71d36`
- Imagem: `ghcr.io/figranium/figranium:0.18.4` (nunca `latest`)
- Execução verificada: `POST /api/tasks/:id/api`, síncrona, autenticada por `x-api-key`.
- Resultados funcionais: `success`, `error`, `stopped`, `crashed`, `anti_bot`; todos podem chegar em HTTP 200.
- Downloads: a resposta contém itens de Cabinet e o download autenticado usa `/api/cabinets/:cabinetId/items/:itemId/download`.
- O adaptador envia `runId`, `sessionId`, `disableRecording=true` e `statelessExecution=false` e não registra variáveis.

## Isolamento e habilitação segura

Na versão fixada, “Task-dedicated browser state & cookie buckets” continua no roadmap. Embora exista `sessionId`, a implementação também sincroniza estado compartilhado. Portanto `sessionId` sozinho **não comprova isolamento entre contas**.

Cada conexão habilitada deve apontar para uma instância Figranium dedicada, com volume `data` dedicado e uma chave de instância resolvida apenas no backend. O BKO exige a confirmação `dedicated_instance`. Compartilhar a mesma instância entre conexões permanece bloqueado até um teste de isolamento ser documentado. Gravações de vídeo ficam desabilitadas nas chamadas para reduzir exposição de digitação de segredo; o volume de captures continua persistente para evidências/screenshot geradas pelo executor e deve seguir retenção restrita. A ausência de redaction nativa também está no roadmap.

## Fluxos versionados

Definições exportadas ficam em `packages/connectors/src/providers/torge/workflows`. Elas não contêm credenciais, IDs de ambiente nem seletores sem evidência. Um vínculo (`BrowserWorkflowBinding`) associa `provider + workflowKey + workflowVersion + environment + instanceKey` ao `externalTaskId`. A publicação faz upsert por identidade lógica e sempre força schedule desabilitado. Edições no editor visual precisam ser exportadas e revisadas antes de alterar a versão no repositório.

## Lacunas concretas que justificam persistência nova

`SyncJob` não representa módulos, tentativa/lease/checkpoint, execução externa ou artefato. Foram adicionadas entidades específicas, relacionadas a `DataSource`/`SyncJob`, sem substituir tabelas existentes. `pg-boss` fornece singleton, expiração e retry; leases persistidos protegem também retomada e execução fora da janela do job.

## Extensão para um segundo provedor

1. Registre uma `ProviderDefinition` com ID estável e módulos.
2. Implemente um conector que dependa apenas de `BrowserExecutor`, nunca de Figranium diretamente.
3. Adicione workflows exportados, parsers e validações do provedor.
4. Registre a fonte no catálogo do domínio e injete o mesmo executor no factory.
5. Crie fixtures sintéticas, testes de parser/completude e um catálogo de cobertura.

Nenhuma alteração interna no `FigraniumBrowserExecutor` é necessária para adicionar outro provedor.