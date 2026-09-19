# Tactia — imagem de produção (Next.js standalone).
# Build a partir da raiz do repositório:
#   docker build -f docker/Dockerfile -t tactia-web .
#   docker build -f docker/Dockerfile --build-arg APP_PACKAGE=@tactia/admin --build-arg APP_DIR=apps/admin --build-arg APP_PORT=3001 -t tactia-admin .
#
# Stages:
#   runner   (default) → serve o Next.js
#   migrator          → aplica as migrations e sai

FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache openssl
WORKDIR /repo

# ---------------------------------------------------------------------------
# deps — instala com o lockfile
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY apps/landing/package.json apps/landing/
COPY packages/ai/package.json packages/ai/
COPY packages/connectors/package.json packages/connectors/
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
COPY packages/execution/package.json packages/execution/
COPY packages/intelligence/package.json packages/intelligence/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# builder — Prisma client + next build (standalone)
# ---------------------------------------------------------------------------
FROM base AS builder
ARG APP_PACKAGE=@tactia/web
ENV NEXT_TELEMETRY_DISABLED=1
# Teto do processo Node. O Rust do Turbopack ainda pode passar disso; o teto
# real do host é `docker compose build --memory` no scripts/deploy.sh.
ENV NODE_OPTIONS="--max-old-space-size=2048"
COPY --from=deps /repo/ ./
COPY . .
RUN pnpm --filter @tactia/database generate
# Placeholders passados apenas para este comando (não ficam no ambiente da
# imagem): o build não conecta no banco, mas os módulos exigem as variáveis.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    BETTER_AUTH_SECRET=placeholder-de-build-com-32-caracteres \
    ADMIN_AUTH_SECRET=placeholder-de-build-com-32-caracteres \
    pnpm --filter ${APP_PACKAGE} build

# ---------------------------------------------------------------------------
# migrator — `prisma migrate deploy` (sem o bundle Next; só deps + schema)
# ---------------------------------------------------------------------------
FROM deps AS migrator
COPY packages/database/prisma packages/database/prisma
COPY packages/database/package.json packages/database/package.json
WORKDIR /repo/packages/database
CMD ["pnpm", "migrate:deploy"]

# ---------------------------------------------------------------------------
# runner — só o necessário para servir
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
ARG APP_DIR=apps/web
ARG APP_PORT=3000
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=${APP_PORT}
ENV HOSTNAME=0.0.0.0
ENV APP_SERVER=${APP_DIR}/server.js
# O bundle do Next perde o caminho relativo do query engine do Prisma; apontar
# explicitamente é o escape hatch documentado (não é segredo, é um caminho).
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/packages/database/src/generated/client/libquery_engine-linux-musl-openssl-3.0.x.so.node

RUN addgroup -g 1001 -S nodejs && adduser -S tactia -u 1001
RUN mkdir -p /data/uploads && chown tactia:nodejs /data/uploads

COPY --from=builder --chown=tactia:nodejs /repo/${APP_DIR}/.next/standalone ./
COPY --from=builder --chown=tactia:nodejs /repo/${APP_DIR}/.next/static ./${APP_DIR}/.next/static

USER tactia
EXPOSE ${APP_PORT}

# `next start` não é usado no modo standalone.
CMD ["sh", "-c", "node $APP_SERVER"]
