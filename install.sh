#!/usr/bin/env bash
# install.sh — zero-question bootstrap for PrimeLoop.
#
#   ./install.sh            build from source (docker-compose.yml)
#   ./install.sh --prod     use a published image (docker-compose.prod.yml,
#                           requires PRIMELOOP_IMAGE in .env)
#   ./install.sh --no-start prepare .env only, don't run docker compose
#
# Idempotent: existing non-empty .env values are never overwritten.
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE_FILE="docker-compose.yml"
START=1
for arg in "$@"; do
  case "$arg" in
    --prod) COMPOSE_FILE="docker-compose.prod.yml" ;;
    --no-start) START=0 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

command -v docker >/dev/null 2>&1 || { echo "error: docker is required — https://docs.docker.com/get-docker/" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "error: docker compose v2 is required" >&2; exit 1; }

# ── .env scaffolding ──────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  echo "created .env from .env.example"
fi

# read the current value of $1 from .env (empty string if unset/missing)
env_get() {
  sed -n "s/^$1=//p" .env | tail -n1
}

# set $1=$2 in .env, replacing the existing line or appending
env_set() {
  if grep -q "^$1=" .env; then
    # use | as sed delimiter; values here never contain |
    sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    od -vN "$1" -An -tx1 /dev/urandom | tr -d ' \n'
  fi
}

# ── secrets: generate anything the user would otherwise have to invent ───────
PG_PASS="$(env_get POSTGRES_PASSWORD)"
if [ -z "$PG_PASS" ] || [ "$PG_PASS" = "changeme" ]; then
  env_set POSTGRES_PASSWORD "$(rand_hex 16)"
  echo "generated POSTGRES_PASSWORD"
fi

if [ -z "$(env_get SECRET_ENCRYPTION_KEY)" ]; then
  env_set SECRET_ENCRYPTION_KEY "$(rand_hex 32)"
  echo "generated SECRET_ENCRYPTION_KEY"
fi

# ── port: detect conflicts on the host port and pick a free one ──────────────
port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -tln 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tln 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&-; return 0; } || return 1
  fi
}

PORT="$(env_get PRIMELOOP_PORT)"
[ -n "$PORT" ] || PORT=3100
if port_in_use "$PORT"; then
  ORIG_PORT="$PORT"
  while port_in_use "$PORT"; do PORT=$((PORT + 1)); done
  env_set PRIMELOOP_PORT "$PORT"
  echo "port $ORIG_PORT is already in use — using $PORT instead (PRIMELOOP_PORT in .env)"
fi

if [ "$COMPOSE_FILE" = "docker-compose.prod.yml" ] && [ -z "$(env_get PRIMELOOP_IMAGE)" ]; then
  echo "error: --prod requires PRIMELOOP_IMAGE in .env (a published image, e.g. ghcr.io/<owner>/primeloop:latest)" >&2
  exit 1
fi

# ── start ─────────────────────────────────────────────────────────────────────
if [ "$START" = "1" ]; then
  echo "starting PrimeLoop (compose file: $COMPOSE_FILE)..."
  docker compose -f "$COMPOSE_FILE" up -d --build
  echo
  echo "PrimeLoop is starting at http://localhost:$PORT"
  echo "  first-run setup:  open the URL above and follow the wizard"
  echo "  follow logs:      docker compose -f $COMPOSE_FILE logs -f backend"
  echo "  health check:     curl http://localhost:$PORT/health"
else
  echo ".env is ready — start with: docker compose -f $COMPOSE_FILE up -d --build"
fi
