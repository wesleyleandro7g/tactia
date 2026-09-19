#!/usr/bin/env bash
# Deploy de produção da Tactia (web / admin / landing / stack completo).
#
# Uso (na raiz do repositório):
#   ./scripts/deploy.sh              # web + admin + landing (+ deps)
#   ./scripts/deploy.sh all          # idem
#   ./scripts/deploy.sh web          # só o app dos clientes
#   ./scripts/deploy.sh admin        # só o Tactia Ops
#   ./scripts/deploy.sh landing      # só a LP de consultoria
#   ./scripts/deploy.sh --pull web   # git pull antes do deploy
#   ./scripts/deploy.sh status       # status dos containers
#   ./scripts/deploy.sh logs web     # logs (siga com -f se quiser)
#
# O build do Next fica limitado a ~2.5 GB. Sem isso, o Turbopack enche os 6 GB
# do VPS, a máquina trava e o SSH cai.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT}/docker/docker-compose.prod.yml"
ENV_FILE="${ROOT}/.env.production"
SWAPFILE="/home/wesley/tactia-swap"
# Folga para SSH + postgres/web/admin/minio (~1 GB) neste host de 6 GB.
BUILD_MEMORY="${BUILD_MEMORY:-3072m}"
PULL=0

# BuildKit/bake em paralelo ignora o limite e duplica o pico de RAM.
export COMPOSE_BAKE=false
export COMPOSE_PARALLEL_LIMIT=1

cd "${ROOT}"

usage() {
  cat <<'EOF'
Deploy de produção da Tactia (web / admin / landing / stack completo).

Uso (na raiz do repositório):
  ./scripts/deploy.sh              # web + admin + landing (+ deps)
  ./scripts/deploy.sh all          # idem
  ./scripts/deploy.sh web          # só o app dos clientes
  ./scripts/deploy.sh admin        # só o Tactia Ops
  ./scripts/deploy.sh landing      # só a LP de consultoria (:3002)
  ./scripts/deploy.sh both         # web + admin
  ./scripts/deploy.sh --pull web   # git pull antes do deploy
  ./scripts/deploy.sh status       # status dos containers
  ./scripts/deploy.sh logs web     # logs
  ./scripts/deploy.sh migrate      # só prisma migrate deploy
EOF
  exit "${1:-0}"
}

need_env() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Erro: falta ${ENV_FILE}" >&2
    echo "Copie de .env.example e preencha os valores reais." >&2
    exit 1
  fi
  if [[ ! -f "${COMPOSE_FILE}" ]]; then
    echo "Erro: falta ${COMPOSE_FILE}" >&2
    exit 1
  fi
}

compose() {
  # Variáveis do shell têm precedência sobre --env-file; limpa as de dev.
  env -u DATABASE_URL -u ENCRYPTION_KEY \
    docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"
}

mem_available_mb() {
  awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo
}

ensure_swap() {
  local have_mb
  have_mb="$(awk '/SwapTotal/{printf "%d", $2/1024}' /proc/meminfo)"
  if [[ "${have_mb}" -ge 3500 ]]; then
    echo "→ swap ok (${have_mb} MB)"
    return 0
  fi
  echo "→ swap atual ${have_mb} MB; criando ${SWAPFILE} (4 GB) para o host não travar"
  local sudo_cmd=(sudo)
  if [[ -n "${SUDO_ASKPASS:-}" ]] && sudo -A -n true 2>/dev/null; then
    sudo_cmd=(sudo -A)
  elif sudo -n true 2>/dev/null; then
    sudo_cmd=(sudo)
  elif [[ ! -t 0 ]]; then
    echo "   sudo precisa de senha e este terminal não é interativo." >&2
    echo "   Rode uma vez: sudo fallocate -l 4G ${SWAPFILE} && sudo chmod 600 ${SWAPFILE} && sudo mkswap ${SWAPFILE} && sudo swapon ${SWAPFILE}" >&2
    return 0
  fi
  if [[ ! -f "${SWAPFILE}" ]]; then
    "${sudo_cmd[@]}" fallocate -l 4G "${SWAPFILE}"
    "${sudo_cmd[@]}" chmod 600 "${SWAPFILE}"
    "${sudo_cmd[@]}" mkswap "${SWAPFILE}" >/dev/null
  fi
  "${sudo_cmd[@]}" swapon "${SWAPFILE}" 2>/dev/null || true
  if ! grep -qF "${SWAPFILE}" /etc/fstab; then
    echo "${SWAPFILE} none swap sw 0 0" | "${sudo_cmd[@]}" tee -a /etc/fstab >/dev/null
  fi
  # Prefere matar o build a matar o sshd.
  if [[ -r /proc/1/oom_score_adj ]]; then
    local pid
    for pid in $(pgrep -x sshd || true); do
      echo -1000 | "${sudo_cmd[@]}" tee "/proc/${pid}/oom_score_adj" >/dev/null || true
    done
  fi
}

preflight() {
  echo "→ memória disponível: $(mem_available_mb) MB  |  limite do build: ${BUILD_MEMORY}"
  ensure_swap
}

health() {
  local url="$1"
  local label="$2"
  local body
  if body="$(curl -fsS --max-time 10 "${url}" 2>/dev/null)"; then
    echo "OK  ${label}: ${body}"
  else
    echo "WARN ${label}: sem resposta em ${url}" >&2
  fi
}

maybe_pull() {
  if [[ "${PULL}" -eq 1 ]]; then
    echo "→ git pull"
    git pull --ff-only
  fi
}

# Build com teto de RAM. `up --build` não aceita --memory e ainda recria o postgres.
build_image() {
  local service="$1"
  echo "→ build ${service} (memory=${BUILD_MEMORY})"
  compose build --memory "${BUILD_MEMORY}" "${service}"
}

run_migrate() {
  echo "→ migrations"
  compose up -d --no-build postgres
  compose run --rm --no-deps migrate
}

start_services() {
  local -a services=("$@")
  if [[ ${#services[@]} -eq 0 ]]; then
    services=(web admin landing)
  fi
  echo "→ up: ${services[*]}"
  compose up -d --no-build --no-deps "${services[@]}"
}

finish() {
  echo "→ status"
  compose ps
  echo "→ health"
  health "http://127.0.0.1:3000/api/v1/health" "web  :3000"
  health "http://127.0.0.1:3001/api/v1/health" "admin:3001"
  health "http://127.0.0.1:3002/_health" "landing:3002"
}

deploy_services() {
  local -a services=("$@")
  preflight
  build_image migrate
  if [[ ${#services[@]} -eq 0 ]]; then
    build_image web
    build_image admin
    build_image landing
  else
    local service
    for service in "${services[@]}"; do
      build_image "${service}"
    done
  fi
  run_migrate
  start_services "${services[@]}"
  finish
}

# --- args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage 0 ;;
    --pull) PULL=1; shift ;;
    *) break ;;
  esac
done

TARGET="${1:-all}"

case "${TARGET}" in
  all|full|stack)
    need_env
    maybe_pull
    deploy_services
    ;;
  web|produto)
    need_env
    maybe_pull
    deploy_services web
    ;;
  admin|ops|bko)
    need_env
    maybe_pull
    deploy_services admin
    ;;
  landing|lp|consultoria)
    need_env
    maybe_pull
    # Landing depende do web healthy; só rebuild/recria a LP.
    preflight
    build_image landing
    compose up -d --no-build landing
    finish
    ;;
  both|apps)
    need_env
    maybe_pull
    deploy_services web admin
    ;;
  status|ps)
    need_env
    compose ps
    ;;
  logs)
    need_env
    shift || true
    compose logs --tail=100 "$@"
    ;;
  migrate)
    need_env
    maybe_pull
    compose run --rm migrate
    ;;
  *)
    echo "Alvo desconhecido: ${TARGET}" >&2
    usage 1
    ;;
esac
