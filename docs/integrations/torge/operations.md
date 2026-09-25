# Operação da integração Torge por navegador

Status em 21/09/2026: código implantável, **não ativado em produção** e sem validação real de login/download Torge.

## Pré-requisitos

- PostgreSQL com a migração `20260921140000_browser_integrations` aplicada.
- `JOBS_ENABLED=true` em `web` e `admin`; o `apps/web` é o único worker/agendador.
- ObjectStorage local/S3 configurado.
- Uma instância Figranium **v0.18.4** (`efdd123c5d1bd49cfbae4c56c0e7f01eb9c71d36`) e um volume `data` exclusivos por conexão Torge.
- API key do Figranium, `SESSION_SECRET` forte e acesso restrito à rede Tactia. Não publicar no navegador/VNC na internet.

O compose inclui uma instância piloto pinada. Para uma segunda conexão, clone o serviço e os volumes com nomes distintos; nunca compartilhe o volume. Configure `FIGRANIUM_INSTANCES_JSON` no web e admin. Cada entrada contém `baseUrl`, `apiKey`, `dedicatedConnectionId` e os vínculos de workflow. O valor é segredo operacional e não vai para `NEXT_PUBLIC_*`.

## Subida local

```bash
cp .env.example .env
# configure os placeholders, sem credenciais reais no repositório
docker compose -f docker/docker-compose.yml --profile browser-integrations up -d
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test pnpm db:migrate:deploy
pnpm db:generate
```

Crie a API key no Figranium. O compose expõe a UI somente em `127.0.0.1:11345`; em produção, use túnel/reverse proxy autenticado e TLS se acesso operacional for necessário.

## Publicação de workflow

1. Construa/valide o fluxo no editor visual com conta autorizada, operações somente de leitura e schedule desligado.
2. Exporte e concilie a definição com o repositório. Não inclua valores de credencial, cookie, ID de ambiente ou dados identificáveis.
3. Incremente `workflowVersion`; não edite silenciosamente uma versão publicada.
4. Execute:

```bash
TACTIA_ENVIRONMENT=staging \
  pnpm --filter @tactia/admin publish:browser-workflow -- \
  torge-connection-key packages/connectors/src/providers/torge/workflows/products.v1.json torge
```

O comando recusa manifestos `publishable:false` e valores com chaves sensíveis. Para fluxos qualificados, faz upsert pelo marcador lógico, força schedule desabilitado e grava `BrowserWorkflowBinding` com checksum. Atualize também o vínculo em `FIGRANIUM_INSTANCES_JSON` antes de executar; a nova versão não altera jobs em andamento.

O smoke controlado está em `browser/engines/figranium/workflows/browser-smoke.v1.json` e usa `example.com`, sem segredo. Testes automatizados mockam a rede; executar o smoke real é uma etapa de qualificação do ambiente.

## Cadastro e habilitação

1. No BKO, abra Empresa → Fontes → Nova fonte → Torge.
2. Informe conta/empresa, filial, chave da instância dedicada, módulos, fuso, horário (múltiplos de 5 min) e janelas.
3. Informe usuário/senha Torge; o segredo é AES-256-GCM e nunca volta na API.
4. A fonte nasce `draft`. “Testar conexão” verifica saúde da infraestrutura; login/escopo real continuam pendentes até o workflow qualificado.
5. Habilite somente após confirmar: instância dedicada, fluxo publicado, login, filial, download/conteúdo, identidade e total sob os mesmos filtros.

Criar não dispara histórico. “Sincronizar agora” apenas enfileira. Pausar preserva dados. Excluir muda para `inactive`.

## Estados e recuperação

- Agregado: `pending`, `running`, `completed`, `partial`, `failed`, `cancelled`, `needs_attention`.
- Módulo: `queued`, `running`, `succeeded`, `failed`, `cancelled`, `needs_attention`.
- `anti_bot`, credencial inválida e workflow ausente exigem atenção e não são tratados como indisponibilidade transitória.
- pg-boss limita retries e usa backoff/expiração. Índice parcial impede dois jobs ativos por fonte; a chave `torge-daily:<connection>:<data-local>` impede duplicidade diária.
- Run ID externo é persistido antes da chamada. Retry do worker retorna para jobs terminais e upsert de raw/import evita duplicação.
- Se o tick do horário exato for perdido, o primeiro tick posterior do mesmo dia cria no máximo um job pela chave diária; não é gerado um job para cada horário perdido.
- Cancelamento não promete interromper a chamada remota, mas o worker consulta o estado antes da publicação e descarta o resultado cancelado.
- Falha/incompletude não avança checkpoint nem `lastSyncAt` e não reconcilia ausências.

## Artefatos e retenção

Downloads aceitos somente no padrão autenticado de Cabinet da mesma origem Figranium. Limite: 100 MiB. Os bytes são copiados ao ObjectStorage tenant-scoped, recebem SHA-256 e metadados. HTML de login, vazio, schema divergente, duplicidade ou total incompatível falham.

Retenção inicial no registro: 30 dias. Configure lifecycle equivalente no S3/MinIO e uma rotina de limpeza antes de produção; o código não remove automaticamente objetos vencidos nesta entrega. Downloads no BKO passam por rota operator-only, validam tenant e geram audit log.

## Backup e atualização

Inclua no backup: PostgreSQL, bucket/prefixos de artefatos, `FIGRANIUM_INSTANCES_JSON` no cofre, volume `data` de cada instância e definições versionadas do repositório. Capturas não são fonte de configuração. Teste restauração em staging.

Para atualizar Figranium, fixe nova tag/commit, revise README/AGENT_SPEC/OpenAPI/código, execute smoke, teste isolamento e dois ciclos Torge em staging, depois altere a imagem. Não use `latest`.

## Diagnóstico

- `FIGRANIUM_SESSION_NOT_ISOLATED`: instância não corresponde ao `connectionId`; não contorne.
- `FIGRANIUM_ANTI_BOT`: verificação interativa; não automatizar bypass.
- `TORGE_PRODUCTS_SCHEMA_CHANGED`: capture arquivo autorizado e crie nova versão do perfil/parser.
- `TORGE_PRODUCTS_INCOMPLETE`: compare filtros e total; preserve versão válida anterior.
- Job eternamente running: confira pg-boss, lease/expiração e saúde do worker; não redispare antes de reconciliar o run ID.
- Data `6/1/2026`: valide localidade/controle na sessão real; erro de pesquisa não é resultado vazio.

Logs estruturados usam `request_id`, `tenant_id`, `data_source_id`, `sync_job_id`, operação e status. Nunca adicione parâmetros/credenciais aos logs.