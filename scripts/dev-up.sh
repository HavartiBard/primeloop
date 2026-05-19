#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

ACP_DEV_DATABASE_HOST="${ACP_DEV_DATABASE_HOST:-192.168.20.14}"
ACP_DEV_DATABASE_PORT="${ACP_DEV_DATABASE_PORT:-55433}"
ACP_DEV_DATABASE_NAME="${ACP_DEV_DATABASE_NAME:-agent_cp_dev}"
ACP_DEV_DATABASE_USER="${ACP_DEV_DATABASE_USER:-agent_cp}"
ACP_DEV_DATABASE_PASSWORD="${ACP_DEV_DATABASE_PASSWORD:-agent_cp_dev}"

export DATABASE_URL="${DATABASE_URL:-postgresql://${ACP_DEV_DATABASE_USER}:${ACP_DEV_DATABASE_PASSWORD}@${ACP_DEV_DATABASE_HOST}:${ACP_DEV_DATABASE_PORT}/${ACP_DEV_DATABASE_NAME}}"
export SECRET_ENCRYPTION_KEY="${SECRET_ENCRYPTION_KEY:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
export PORT="${PORT:-3100}"
WEB_PORT="${WEB_PORT:-5173}"
export ACP_BACKEND_URL="${ACP_BACKEND_URL:-http://127.0.0.1:${PORT}}"

VM_IP="${ACP_VM_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
if [[ -z "${VM_IP}" ]]; then
  VM_IP="127.0.0.1"
fi

echo "Starting backend on http://${VM_IP}:${PORT}"
echo "Starting web on http://${VM_IP}:${WEB_PORT}"
echo "Using DATABASE_URL=${DATABASE_URL}"

backend_pid=""
web_pid=""

kill_listeners_on_port() {
  local port="$1"
  local pids=""

  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "${port}/tcp" 2>/dev/null || true)"
  elif command -v ss >/dev/null 2>&1; then
    pids="$(
      ss -ltnp 2>/dev/null \
        | awk -v target=":${port}" '$4 ~ target { print $NF }' \
        | rg -o '[0-9]+' \
        | sort -u \
        || true
    )"
  fi

  if [[ -z "${pids//[[:space:]]/}" ]]; then
    return
  fi

  echo "Clearing stale listener(s) on port ${port}: ${pids//$'\n'/ }"
  while read -r pid; do
    [[ -z "${pid}" ]] && continue
    kill "${pid}" 2>/dev/null || true
  done <<< "${pids}"

  sleep 1

  while read -r pid; do
    [[ -z "${pid}" ]] && continue
    if kill -0 "${pid}" 2>/dev/null; then
      kill -9 "${pid}" 2>/dev/null || true
    fi
  done <<< "${pids}"
}

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if [[ -n "${web_pid}" ]] && kill -0 "${web_pid}" 2>/dev/null; then
    kill "${web_pid}" 2>/dev/null || true
  fi
  if [[ -n "${backend_pid}" ]] && kill -0 "${backend_pid}" 2>/dev/null; then
    kill "${backend_pid}" 2>/dev/null || true
  fi
  wait || true
  exit "${code}"
}

trap cleanup EXIT INT TERM

kill_listeners_on_port "${PORT}"
kill_listeners_on_port "${WEB_PORT}"

(
  cd "${ROOT_DIR}/backend"
  npm run dev
) &
backend_pid=$!

(
  cd "${ROOT_DIR}/web"
  npm run dev:host
) &
web_pid=$!

wait -n "${backend_pid}" "${web_pid}"
