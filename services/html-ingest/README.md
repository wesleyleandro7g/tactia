# HTML ingest (Scrapling parser)

Sidecar Python que busca páginas HTTP autorizadas (cliente HTTPS próprio) e devolve linhas estruturadas via Scrapling `Selector` para o conector `web_portal`. Não substitui o Browser Agent nem o Figranium. Não instala Playwright nem usa `StealthyFetcher`.

Desenvolvimento:

```bash
docker compose -f docker/docker-compose.yml --profile html-ingest --env-file .env up -d --build html-ingest
```

Health: `curl -s http://127.0.0.1:8770/health`

A API privada (`POST /internal/html/extract`) exige `x-html-ingest-token` igual a `HTML_INGEST_TOKEN`. O sidecar recusa hosts fora da allowlist, HTTP em produção, destinos privados e redirecionamentos fora da política. Extração vazia falha, salvo `allowEmpty`. Adaptive SQLite fica em `/data/adaptive/{tenantId}/{dataSourceId}__{resource}.sqlite` e é local à réplica.

Em produção use `--profile html-ingest`, não publique a porta, anexe só `browser_control` e saia por `browser-egress` (`HTML_INGEST_EGRESS_URL`).
