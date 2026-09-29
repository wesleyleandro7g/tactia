# Conector Portal web

Fonte `web_portal` para sistemas do cliente **sem API**, quando CSV, SQL e Torge não cobrem. O operador autoriza os hosts, descreve a receita de extração e mapeia as colunas para as tabelas canônicas. O sync segue o pipeline existente: `RawRecord` → mapping → normalização.

Não use esta fonte para navegar qualquer site da internet, furar Cloudflare ou substituir o Torge/Browser Agent. Páginas que só existem depois de JavaScript pesado continuam no Figranium ou no Browser Agent.

## Quando usar

| Origem | Caminho |
|---|---|
| CSV exportado | Fonte CSV |
| Banco de leitura | Fonte banco de dados |
| ERP Torge | Fonte Torge (Figranium) |
| Portal HTTP com HTML/tabela, login por formulário ou cookie | **Portal web** |

## Pré-requisitos

1. O cliente autoriza a Tactia a ler aquele portal.
2. Sidecar `html-ingest` no ar, com o mesmo `HTML_INGEST_TOKEN` no web, no admin e no sidecar. Sem o sidecar, o produto sobe normalmente; a fonte só falha ao testar ou sincronizar `web_portal`.
3. Receita com `startUrl` nos hosts allowlisted, `itemSelector`, `idField` e `fields` (CSS ou XPath, inclusive pseudo-elementos `::text`).

Desenvolvimento:

```bash
docker compose -f docker/docker-compose.yml --profile html-ingest --env-file .env up -d --build html-ingest
```

```env
HTML_INGEST_URL=http://127.0.0.1:8770
HTML_INGEST_TOKEN=local-html-ingest-token
HTML_INGEST_TEST_LOCAL=true
```

Produção: o sidecar é um profile (`html-ingest`), não sobe com o stack mínimo. Não publique a porta. Coloque o serviço só na rede `browser_control` e saia pela mesma egress do Browser Runtime (`HTML_INGEST_EGRESS_URL=http://browser-egress:8888`). `HTML_INGEST_TEST_LOCAL` fica desligado: só HTTPS, destinos públicos e túnel CONNECT validado a cada salto.

```bash
docker compose -f docker/docker-compose.prod.yml --profile html-ingest --env-file .env.production up -d --build html-ingest
```

```env
HTML_INGEST_URL=http://html-ingest:8770
HTML_INGEST_TOKEN=<segredo forte>
```

## Receita

Exemplo gravado em `DataSource.configuration`:

```json
{
  "allowedHosts": ["portal.cliente.com.br"],
  "adaptive": true,
  "allowEmpty": false,
  "loginUrl": "https://portal.cliente.com.br/login",
  "loginUsernameField": "usuario",
  "loginPasswordField": "senha",
  "resources": [
    {
      "key": "products",
      "startUrl": "https://portal.cliente.com.br/produtos",
      "itemSelector": "tr.produto",
      "idField": "sku",
      "fields": {
        "sku": "td.sku::text",
        "name": "td.nome::text",
        "price": "td.preco::text"
      },
      "pagination": { "nextSelector": "a.next::attr(href)", "maxPages": 20 }
    }
  ]
}
```

`resources[].key` vira `Mapping.sourceEntity`. `idField` vira `external_id`. Credenciais opcionais: usuário/senha (POST de login), `cookie`, `Authorization`.

Depois de registrar a fonte, use o mapeamento usual no Ops para ligar as colunas extraídas a `product`, `customer`, `sale`, etc.

## Limites (V1)

- HTML via cliente HTTPS próprio (stdlib), com IP pinado ou CONNECT na egress. Scrapling entra só como parser (`Selector`). Sem `FetcherSession`, `StealthyFetcher`, Chromium, proxy residencial ou bypass de anti-bot.
- Redirecionamentos não são seguidos automaticamente: cada `Location` passa pela allowlist (e pela pinagem/egress) antes do próximo TCP.
- No máximo 50 páginas e 10.000 linhas por recurso e sync. `offset` é aplicado no sidecar (`offset + limit`), não num recorte de uma página curta.
- Seletor vazio, login HTTP de erro ou layout sem linhas falha (HTTP 422 / teste de conexão negativo), salvo `allowEmpty` explícito na receita ou no recurso.
- Fingerprints adaptativos ficam em SQLite **por** `tenantId` + `dataSourceId` + `resource.key` no volume do sidecar. O SQLite é local à réplica; não compartilhe o volume entre réplicas.
- Sync manual no Ops nesta versão.
