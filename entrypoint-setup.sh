#!/bin/sh
set -e

# Ensure workspace directories exist before starting
mkdir -p "${AGENT_REPO_ROOT:-/workspace/repo}"
mkdir -p "${AGENT_WORKTREE_ROOT:-/workspace/agents}"

# Seed the catalog from image defaults when empty (first boot, or an empty
# host volume mounted at /app/catalog). Never overwrites existing files.
mkdir -p /app/catalog
if [ -d /app/catalog-defaults ] && [ -z "$(ls -A /app/catalog 2>/dev/null)" ]; then
  cp -r /app/catalog-defaults/. /app/catalog/
  echo "seeded /app/catalog from image defaults"
fi

# Start codex app-server in the background (connects the Codex LLM locally)
codex app-server &

exec node dist/index.js
