#!/usr/bin/env bash
set -euo pipefail

# Resolve the main repo root (where this script lives)
# Use git to find the actual repo root, robust even from worktree checkouts
MAIN_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Optional: accept a branch/worktree name or explicit path as argument
TARGET_ROOT=""
if [[ $# -gt 0 ]]; then
  ARG="$1"
  
  # Check if it's an absolute path
  if [[ "${ARG}" = /* ]]; then
    TARGET_ROOT="${ARG}"
  else
    # First check if it's a directory (relative or absolute from cwd)
    if [[ -d "${ARG}" ]]; then
      TARGET_ROOT="$(cd "${ARG}" && pwd)"
    else
      # Check if it's a worktree in the main repo's .worktrees directory
      WORKTREE_PATH="${MAIN_REPO_ROOT}/.worktrees/${ARG}"
      if [[ -d "${WORKTREE_PATH}" ]]; then
        TARGET_ROOT="${WORKTREE_PATH}"
      else
        echo "Error: Cannot resolve worktree or path: ${ARG}" >&2
        echo "  - No worktree found at: ${WORKTREE_PATH}" >&2
        echo "  - No existing directory: ${ARG}" >&2
        exit 1
      fi
    fi
  fi
else
  TARGET_ROOT="${MAIN_REPO_ROOT}"
fi

# Validate target root exists and has required structure
if [[ ! -d "${TARGET_ROOT}" ]]; then
  echo "Error: Target root does not exist: ${TARGET_ROOT}" >&2
  exit 1
fi

if [[ ! -f "${TARGET_ROOT}/backend/package.json" ]] || [[ ! -f "${TARGET_ROOT}/web/package.json" ]]; then
  echo "Error: Target root is not a valid PrimeLoop repo: ${TARGET_ROOT}" >&2
  echo "  Missing backend/package.json and/or web/package.json" >&2
  exit 1
fi

ROOT_DIR="${TARGET_ROOT}"

# Source .env from target root if present, otherwise fall back to main repo
ENV_FILE="${ROOT_DIR}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  ENV_FILE="${MAIN_REPO_ROOT}/.env"
fi
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ENV_FILE}"
  set +a
fi

# Defaults match the disposable dev Postgres from docker-compose.dev.yml
# (localhost:55433). Point PRIMELOOP_DEV_DATABASE_* at a hosted dev DB in .env.
PRIMELOOP_DEV_DATABASE_HOST="${PRIMELOOP_DEV_DATABASE_HOST:-${ACP_DEV_DATABASE_HOST:-127.0.0.1}}"
PRIMELOOP_DEV_DATABASE_PORT="${PRIMELOOP_DEV_DATABASE_PORT:-${ACP_DEV_DATABASE_PORT:-55433}}"
PRIMELOOP_DEV_DATABASE_NAME="${PRIMELOOP_DEV_DATABASE_NAME:-${ACP_DEV_DATABASE_NAME:-primeloop_dev}}"
PRIMELOOP_DEV_DATABASE_USER="${PRIMELOOP_DEV_DATABASE_USER:-${ACP_DEV_DATABASE_USER:-primeloop}}"
PRIMELOOP_DEV_DATABASE_PASSWORD="${PRIMELOOP_DEV_DATABASE_PASSWORD:-${ACP_DEV_DATABASE_PASSWORD:-primeloop_dev}}"

export DATABASE_URL="${DATABASE_URL:-postgresql://${PRIMELOOP_DEV_DATABASE_USER}:${PRIMELOOP_DEV_DATABASE_PASSWORD}@${PRIMELOOP_DEV_DATABASE_HOST}:${PRIMELOOP_DEV_DATABASE_PORT}/${PRIMELOOP_DEV_DATABASE_NAME}}"
export SECRET_ENCRYPTION_KEY="${SECRET_ENCRYPTION_KEY:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
export PORT="${PORT:-3100}"
WEB_PORT="${WEB_PORT:-5173}"
export PRIMELOOP_BACKEND_URL="${PRIMELOOP_BACKEND_URL:-${ACP_BACKEND_URL:-http://127.0.0.1:${PORT}}}"

VM_IP="${PRIMELOOP_VM_IP:-${ACP_VM_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}}"
if [[ -z "${VM_IP}" ]]; then
  VM_IP="127.0.0.1"
fi

echo "=== Dev Stack Start ==="
if [[ "${ROOT_DIR}" != "${MAIN_REPO_ROOT}" ]]; then
  echo "Using worktree: ${ROOT_DIR}"
  echo "Main repo:      ${MAIN_REPO_ROOT}"
else
  echo "Using main repo: ${ROOT_DIR}"
fi
echo "Starting backend on http://${VM_IP}:${PORT}"
echo "Starting web on http://${VM_IP}:${WEB_PORT}"
echo "Using DATABASE_URL=${DATABASE_URL}"

backend_pid=""
web_pid=""

kill_listeners_on_port() {
  local port="$1"
  local pids=""

  # Use ss to find PIDs listening on the port
  if command -v ss >/dev/null 2>&1; then
    pids="$(
      ss -ltnp 2>/dev/null \
        | awk -v target=":${port}" '$4 ~ target { print $NF }' \
        | sed -n 's/.*pid=\([0-9]*\).*/\1/p' \
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

# Stop Docker containers that conflict with local dev ports
stop_docker_containers() {
  if command -v docker >/dev/null 2>&1; then
    for container in primeloop-backend-dev-1 agent-control-plane-backend-dev-1 primeloop-backend-1 agent-cp-backend-1; do
      if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        echo "Stopping Docker container ${container} (conflicts with local dev)"
        docker stop "${container}" 2>/dev/null || true
      fi
    done
  fi
}

stop_docker_containers
kill_listeners_on_port "${PORT}"
kill_listeners_on_port "${WEB_PORT}"

# Auto-bootstrap missing dependencies for backend and web
bootstrap_deps() {
  local dir="$1"
  local name="$2"
  local binary="$3"

  if [[ ! -x "${dir}/${binary}" ]]; then
    echo "=== Auto-installing ${name} dependencies ==="
    cd "${dir}"
    npm install --loglevel=info
    echo "=== ${name} dependencies installed ==="
  fi
}

# Bootstrap backend and web dependencies if missing
bootstrap_deps "${ROOT_DIR}/backend" "backend" "node_modules/.bin/tsx"
bootstrap_deps "${ROOT_DIR}/web" "web" "node_modules/.bin/vite"

echo "Starting local dev backend (tsx watch) on port ${PORT}"
echo "Starting local dev web (vite) on port ${WEB_PORT}"
echo "Press Ctrl+C to stop both"
echo

(
  cd "${ROOT_DIR}/backend"
  npm run dev
) &
backend_pid=$!

sleep 1  # Give backend time to start before web connects

(
  cd "${ROOT_DIR}/web"
  npm run dev:host
) &
web_pid=$!

wait -n "${backend_pid}" "${web_pid}"
