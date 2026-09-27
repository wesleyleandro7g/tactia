# Relatório de aceite — Torge/Figranium

Data: 21/09/2026. Produção: **não ativada**.

## Implementado e validado automaticamente

- Contrato `BrowserExecutor` independente de provedor/executor e adaptador Figranium injetável.
- Figranium v0.18.4/commit fixado; endpoint síncrono e outcomes funcionais normalizados, inclusive HTTP 200 com `error`, `crashed`, `stopped` e `anti_bot`.
- Origem do executor validada, redirect bloqueado, resposta limitada, task binding obrigatório e Cabinet ref allowlisted.
- Instância deve declarar o `connectionId` dedicado; segredo de serviço e credenciais permanecem backend-only.
- Catálogo Torge separa implementado/pendente/não aplicável; módulos pendentes são rejeitados ao habilitar o conector.
- Parser de produtos rejeita HTML de login, vazio, binário, CSV inválido, coluna ausente, decimal/status inválido e identidade duplicada; preserva zeros à esquerda, nulo e zero.
- Identidade raw/canônica inclui conexão via `dataSourceId` e prefixo conta/filial.
- Completude exige `complete=true`, total equivalente e identidades únicas; coleta incompleta não escreve raw.
- `SyncJob` agregado reutilizado; módulo/artefato/vínculo foram adicionados apenas para lacunas reais.
- Índice parcial e reconciliação de corrida impedem dois jobs ativos por fonte; chave diária usa data no fuso da conexão.
- Run ID externo é persistido antes da execução; módulo registra tentativa, lease, versões e erro seguro.
- Falha de módulo é excluída da normalização, preservando raw/publicação válida anterior. Checkpoint só é gravado após publicação canônica.
- Cancelamento pendente/running é auditado e impede publicação após retorno remoto.
- Raw e Import usam upsert/chave idempotente; regressão CSV existente passou sem duplicação.
- Artefatos são copiados ao ObjectStorage tenant-scoped com hash/limite/retenção e acesso BKO auditado.
- BKO operator-only cadastra em draft, testa infraestrutura, habilita, pausa, sincroniza, cancela e acompanha módulos/artefatos.
- pg-boss, tick e worker existentes foram reutilizados; schedule Figranium fica desligado.

Evidência local executada: 28 testes de connectors; **123/123 testes da suíte completa de domain** (incluindo PostgreSQL, CSV, BKO, isolamento e idempotência); 29 testes de execution; 2 testes de database; 1 teste de admin. Typecheck isolado passou em connectors, database, domain, web e admin. Migração foi aplicada com sucesso em `tactia_test`.

## Implementado sem validação real Torge/Figranium

- Chamada Figranium, download Cabinet e publicação de task foram testados com mocks/contratos verificados, não com instância real.
- Parser/mapping de produtos e fallback de saída estruturada existem, mas nenhum CSV real Torge foi capturado.
- Compose e smoke workflow existem, mas o smoke não foi executado contra container nesta sessão.
- Agendamento por fuso e cinco minutos está implementado, mas não foi observado por 24 horas.
- Estado agregado `partial` está implementado; o catálogo só permite produtos, portanto o cenário multimódulo aguarda um segundo módulo validado.

## Bloqueado por evidência/acesso

- Fluxo `torge.products@1` permanece `publishable:false`: faltam seletores autorizados, identidade global e arquivo/saída real. Não há senha real no repositório.
- Login, expiração, desafios interativos, troca de filial e isolamento de duas contas não foram qualificados.
- Figranium ainda lista cookie buckets dedicados no roadmap; por isso a arquitetura exige uma instância/volume por conexão.
- Captura de CSV, cabeçalhos, delimiter/encoding, paginação/export de todas as páginas e limites Torge não foram comprovados.
- Todos os demais módulos do catálogo estão pendentes e não podem aparecer como sincronizados.
- Dois ciclos completos em momentos distintos, contagens reais e carga/duração não puderam ser medidos sem ambiente autorizado.
- Retenção possui metadata/lifecycle documentado, mas a rotina automática de expurgo de objetos ainda não foi implementada.
- Reprocessamento offline de artefato armazenado ainda não possui ação BKO; o download autorizado está disponível para diagnóstico.

## Fora de escopo mantido

Nenhuma escrita, emissão, transmissão fiscal, cancelamento, contratação, ampliação de permissão, bypass de desafio, OCR/IA ou acesso a endpoint privado Torge foi criado. Playwright direto, app web e pacotes `ai`/`intelligence` não foram alterados para esta integração.

## Critério para declarar produção ativa

Somente após: publicar workflow reconciliado; configurar instância/volume/chaves; validar login e escopo; capturar e validar dados reais; conferir total/identidades; executar ao menos dois ciclos completos em staging; testar recuperação/cancelamento; aplicar migração/backup/retention; habilitar conexão e observar uma publicação bem-sucedida no ambiente de produção. Nenhum desses fatos de ambiente foi assumido neste relatório.