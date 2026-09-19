# Integração do ChatGPT com o MCP da Tactia

## Arquitetura implementada

O endpoint público é `https://SEU_DOMINIO/mcp`. Ele usa Streamable HTTP e expõe o
mesmo `ToolRegistry` usado pelo chat da Tactia. Não existe um segundo agente ou
orquestrador no servidor MCP.

O endpoint legado `/api/v1/mcp`, autenticado por API key de tenant, continua
disponível para integrações internas. O ChatGPT deve usar `/mcp`, autenticado por
OAuth 2.1.

O fluxo OAuth é fornecido pelo Better Auth e contém:

- Authorization Code com PKCE `S256`;
- Client ID Metadata Documents (CIMD), limitado aos documentos publicados em
  `https://chatgpt.com`;
- autenticação de clientes públicos com PKCE e de clientes CIMD por
  `private_key_jwt`, validando a assinatura com o JWKS publicado pelo cliente;
- access token JWT de 10 minutos, com `aud` preso à URL do MCP;
- refresh token rotativo de 30 dias, sem janela de reutilização;
- uma empresa escolhida por autorização, gravada no consentimento e nos claims;
- seleção de empresa imutável por fluxo PKCE, isolada de outras abas;
- validação da membership ativa e do consentimento em cada chamada;
- rate limit atômico no PostgreSQL, compartilhado entre réplicas da aplicação;
- revogação imediata em **Configurações → Conexões**;
- tokens vinculados ao ID do consentimento: reconectar não reativa JWTs revogados;
- descoberta RFC 9728 e RFC 8414;
- desafio `WWW-Authenticate` no endpoint MCP.

`get_profile` identifica a membership autorizada com um ID opaco estável, além
do nome, e-mail e rótulo da empresa. A tool publica `_meta["openai/profile"]` e
retorna o perfil em `structuredContent`.

Os scopes são:

| Scope | Permissão |
|---|---|
| `tools:read` | Consultar métricas, dados, documentos, memória e análises |
| `tools:propose` | Criar uma proposta que fica aguardando aprovação humana |

Usuários `viewer` não recebem `tools:propose`. O ChatGPT não recebe tools que
escrevem diretamente, como `remember_fact` e `generate_infographic`.
`propose_action` é o único caminho mutável publicado: ele aceita uma chave de
idempotência, cria uma execução com origem `mcp` e nunca pula a aprovação da
Tactia.

## Configuração de produção

Defina URLs públicas estáveis e idênticas, sem barra final:

```env
BETTER_AUTH_URL=https://app.tactia.com.br
NEXT_PUBLIC_APP_URL=https://app.tactia.com.br
BETTER_AUTH_SECRET=<segredo aleatório com pelo menos 32 caracteres>
```

O domínio precisa servir HTTPS com certificado válido. Depois do deploy, aplique
as migrations antes de iniciar a aplicação:

```bash
pnpm --filter @tactia/database exec prisma migrate deploy
```

Valide os documentos públicos:

```bash
curl https://app.tactia.com.br/.well-known/oauth-protected-resource/mcp
curl https://app.tactia.com.br/.well-known/oauth-authorization-server/api/v1/auth
curl -i -X POST https://app.tactia.com.br/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

A última chamada deve responder `401` e publicar `resource_metadata` no header
`WWW-Authenticate`.

## Conectar no ChatGPT

No modo desenvolvedor do ChatGPT, crie um app MCP apontando para:

```text
https://app.tactia.com.br/mcp
```

Selecione OAuth com CIMD na configuração da conexão. O ChatGPT descobre o servidor OAuth automaticamente. O usuário entra na Tactia,
escolhe uma empresa quando possui mais de uma e revisa os scopes. O consentimento
aparece em `/settings/connections` e pode ser revogado pelo próprio usuário ou
por um administrador da empresa.

Para publicar no diretório de apps, conclua também as etapas operacionais da
OpenAI: verificação da organização e do domínio, política de privacidade e termos
públicos, ícone e informações do app, além da revisão de segurança. A URL MCP e
os metadados OAuth usados na submissão devem ser os mesmos do ambiente de
produção.

A referência oficial de
[autenticação da OpenAI](https://developers.openai.com/plugins/build/auth)
detalha descoberta, CIMD, callbacks, validação dos tokens e contrato do perfil.

## Validação local e operação

O teste `apps/web/src/lib/__tests__/mcp-oauth-flow.test.ts` usa PostgreSQL real e
exercita login com retomada do OAuth, PKCE, emissão de JWT, rotação de refresh,
revogação pela rota da aplicação, reconexão, membership suspensa, isolamento de
seleções, autenticação no `/mcp`, scopes e resposta `429`. Documentos CIMD e JWKS
do cliente são fixtures; a assinatura do cliente e os tokens do servidor são reais.
Esse teste não substitui a homologação com uma conta ChatGPT e HTTPS público.

Verificação local em 19/09/2026: 61 testes web, 102 testes de IA e 29 testes do
motor de execução passaram. A checagem de tipos, o lint dos arquivos OAuth/MCP
e o build de produção com `next build --webpack` também passaram. O lint global
ainda aponta problemas preexistentes nos componentes `hero-prompt` e `web-threads`.

As migrations foram verificadas no banco de teste. A configuração de produção,
o deploy e a publicação no ChatGPT permanecem etapas operacionais separadas.
O segredo de autenticação deve possuir ao menos 32 caracteres; a aplicação
recusa inicializar em produção com segredo ausente ou curto.

Inclua na manutenção periódica a remoção de buckets vencidos de
`mcp_rate_limit_buckets` (`expires_at < NOW()`) e seleções expiradas em
`auth_verifications` (`identifier LIKE 'mcp-company:%'` e `expiresAt < NOW()`).
As seleções expiram em dez minutos; tokens e consentimentos não dependem delas
depois da emissão do código.

## Checklist de revisão

Casos positivos mínimos:

1. login, seleção de empresa e consentimento;
2. `tools/list` mostra apenas as tools compatíveis com o papel e os scopes;
3. uma consulta retorna `data` e `sources` somente da empresa autorizada;
4. `propose_action` cria uma única proposta com `awaiting_approval`;
5. refresh token mantém a conexão e a revogação a bloqueia imediatamente.

Casos negativos mínimos:

1. token ausente, expirado, com issuer ou audience incorretos retorna erro OAuth;
2. `viewer` ou token sem `tools:propose` não chama `propose_action`;
3. tenant enviado nos argumentos não troca a empresa definida no token.

Audite as chamadas por `MCP_TOOL_CALLED`. O log guarda client, nome da tool,
duração e erro, sem persistir os argumentos, reduzindo a exposição de dados
pessoais.
