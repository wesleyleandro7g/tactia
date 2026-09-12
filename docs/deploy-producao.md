# Deploy em produção

Guia para colocar a Tactia no ar em um servidor com Docker Compose. O stack mínimo
sobe **PostgreSQL**, **MinIO** e o **Next.js** (modo standalone) em um único host.

> Depois do deploy, siga [onboarding-cliente.md](./onboarding-cliente.md) para o
> primeiro cliente. Para diagnóstico e operação do dia a dia, veja [runbook.md](./runbook.md).

---

## 1. Pré-requisitos

| Item | Detalhe |
|---|---|
| Servidor | Linux com Docker e Docker Compose |
| Domínio | Ex.: `tactia.suaempresa.com` |
| TLS | Proxy na frente (Caddy, nginx ou ALB) — o compose só expõe a porta 3000 |
| Chave de LLM | Opcional para o resto do sistema; obrigatória para o `/chat` |

---

## 2. Configurar variáveis de ambiente

Na raiz do repositório:

```bash
cp .env.example .env.production
```

Edite `.env.production` com valores reais. Exemplo para produção:

```bash
# Postgres (serviço interno do compose)
POSTGRES_USER=tactia
POSTGRES_PASSWORD=<senha-forte>
POSTGRES_DB=tactia
DATABASE_URL=postgresql://tactia:<senha-forte>@postgres:5432/tactia

# URLs públicas (com HTTPS)
BETTER_AUTH_URL=https://tactia.suaempresa.com
NEXT_PUBLIC_APP_URL=https://tactia.suaempresa.com

# Segredos (gere valores únicos — veja abaixo)
BETTER_AUTH_SECRET=<mínimo 32 caracteres aleatórios>
ENCRYPTION_KEY=<64 caracteres hex = 32 bytes>

# LLM (chat)
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
# Endpoint compatível com OpenAI (Azure, Groq, OpenRouter, Ollama...)
LLM_BASE_URL=

# MinIO (rede interna do compose)
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=<access-key>
S3_SECRET_KEY=<secret-key>
S3_BUCKET=tactia
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true

# Operadores internos (acesso ao /admin)
TACTIA_OPERATOR_EMAILS=voce@empresa.com

# WhatsApp via Evolution API (opcional). Sem isso o cadastro em
# /settings/whatsapp funciona, mas o bot não responde no WhatsApp.
EVOLUTION_API_URL=https://evolution.suaempresa.com
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE=tactia
# EVOLUTION_WEBHOOK_SECRET=

WEB_PORT=3000
LOG_LEVEL=info
```

### Gerar segredos

```bash
# BETTER_AUTH_SECRET (mínimo 32 caracteres)
openssl rand -base64 32

# ENCRYPTION_KEY (64 hex = 32 bytes)
openssl rand -hex 32
```

| Variável | Efeito se faltar ou estiver errada |
|---|---|
| `ENCRYPTION_KEY` (64 hex) | Credenciais não podem ser criadas nem lidas → sync Postgres falha |
| `BETTER_AUTH_SECRET` (≥32 chars) | Sessões inválidas; ninguém entra |
| `DATABASE_URL` | `health` responde 503, aplicação inutilizável |
| `LLM_API_KEY` | Apenas o chat fica indisponível |
| `TACTIA_OPERATOR_EMAILS` | Vazio = `/admin` responde 404 para todos |
| `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` / `EVOLUTION_INSTANCE` | Cadastro de números funciona; o webhook ignora mensagens |

> **Guarde `ENCRYPTION_KEY` em local seguro.** Trocá-la invalida todas as
> credenciais existentes (AES-GCM falha na autenticação da tag). Se for
> inevitável, recrie as credentials e atualize o `credentialId` de cada fonte.

Não commite `.env.production`. Segredos vêm exclusivamente do ambiente — nenhum
arquivo `.env` entra na imagem Docker (`.dockerignore`).

---

## 3. Subir o stack

```bash
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d --build
```

Ordem de subida:

```text
postgres (healthy) → migrate (prisma migrate deploy) → web (Next.js)
```

O serviço `migrate` aplica as migrations e sai. O `web` só sobe depois que ele
termina com sucesso. O container do web roda como usuário não-root (uid 1001).

### Variáveis do shell

Variáveis já exportadas no shell têm precedência sobre `--env-file` no docker
compose. Se o container subir apontando para `localhost:5433`, o seu shell tem um
`DATABASE_URL` de desenvolvimento exportado. Rode em um shell limpo ou:

```bash
env -u DATABASE_URL -u ENCRYPTION_KEY \
  docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d --build
```

---

## 4. Verificar se está no ar

```bash
curl -s http://localhost:3000/api/v1/health
# {"data":{"status":"ok","database":"up"},"meta":{"requestId":"..."}}
```

`health` responde 503 quando o banco não responde — é o sinal do healthcheck do
container e do load balancer.

```bash
docker compose -f docker/docker-compose.prod.yml logs -f web
```

Confirme que nenhum segredo vazou para a imagem:

```bash
docker run --rm --entrypoint sh tactia-web -c 'find / -maxdepth 4 -name ".env" 2>/dev/null'
```

---

## 5. Colocar TLS na frente

O compose publica só a porta **3000**. Em produção, coloque um proxy com HTTPS
na frente do web. Postgres e MinIO ficam na rede interna do compose.

### Caddy

```text
tactia.suaempresa.com {
    reverse_proxy localhost:3000
}
```

### nginx

```nginx
server {
    listen 443 ssl;
    server_name tactia.suaempresa.com;

    ssl_certificate     /etc/letsencrypt/live/tactia.suaempresa.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tactia.suaempresa.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Depois de configurar TLS, confirme que `BETTER_AUTH_URL` e `NEXT_PUBLIC_APP_URL`
usam `https://` e reinicie o container `web` se necessário.

---

## 6. Primeiro cliente

1. Acesse `https://tactia.suaempresa.com/signup` e crie a conta do owner.
2. Siga o wizard em `/onboarding` (arquivo → colunas → conferir → importar).
3. Para CSV: arraste o arquivo na tela ou clique para escolher. Os uploads
   ficam no volume `uploads_data` (`UPLOAD_DIR=/data/uploads`).

4. Valide em `/dashboard`, teste o `/chat` e confira `/approvals`.
5. (Opcional) Chat no WhatsApp: owner/admin cadastra números em `/settings/whatsapp`.
   Na Evolution, aponte o webhook da instância para
   `https://tactia.suaempresa.com/api/v1/webhooks/evolution` com o evento
   `MESSAGES_UPSERT`. Header `apikey` = `EVOLUTION_WEBHOOK_SECRET` ou `EVOLUTION_API_KEY`.

O passo a passo completo está em [onboarding-cliente.md](./onboarding-cliente.md).

---

## 7. Operação contínua

### Logs

```bash
docker compose -f docker/docker-compose.prod.yml logs -f web
```

Toda resposta HTTP traz o header `x-request-id` — use-o para achar a linha
correspondente no log. Detalhes em [runbook.md §2](./runbook.md#2-como-ler-os-logs).

### Migrations

Aplicar migrations sem subir o app:

```bash
docker compose -f docker/docker-compose.prod.yml --env-file .env.production run --rm migrate
```

### Atualizar versão

```bash
git pull
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d --build
```

### Rollback

```bash
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d --no-deps web
```

Use a imagem anterior. Migrations são forward-only; um rollback de schema exige
uma migration nova.

### Backup e restauração

```bash
# backup
docker compose -f docker/docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > tactia-$(date +%F).dump

# restore (destrutivo — confirme o alvo antes)
docker compose -f docker/docker-compose.prod.yml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < tactia-AAAA-MM-DD.dump
```

O backup do banco **não** cobre `ENCRYPTION_KEY`: guarde a chave separadamente ou
as credenciais restauradas ficam ilegíveis.

---

## 8. Limitações da V0.1 em produção

| Limitação | Impacto |
|---|---|
| Sync e execução rodam **inline** no request (se `JOBS_ENABLED` estiver off) | Import muito grande pode estourar o timeout do proxy; ative jobs ou quebre o arquivo |
| CSV por caminho no servidor | Sem upload pela interface; use `docker compose cp` |
| E-mail só no driver `console` | Nenhum e-mail sai de verdade |
| Sem agendamento de sync | Com `JOBS_ENABLED=true` o pipeline diário roda às 03:00 no fuso do tenant; fallback: `POST /api/v1/intelligence/daily` com `CRON_SECRET` |
| Rate limit **in-memory** | Vale por processo; com mais de uma instância o limite efetivo é multiplicado |
| Sem retry de execução falha | Reproponha manualmente |

---

## 9. Resumo rápido

```bash
# 1. Configurar
cp .env.example .env.production   # preencher valores reais

# 2. Deploy
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d --build

# 3. Validar
curl -s http://localhost:3000/api/v1/health

# 4. TLS + domínio no proxy
# 5. Signup + onboarding do primeiro cliente
```

---

## Documentos relacionados

| Documento | Para quê |
|---|---|
| [onboarding-cliente.md](./onboarding-cliente.md) | Colocar o primeiro cliente real |
| [runbook.md](./runbook.md) | Diagnóstico de sync, chat, segredos e escalação |
