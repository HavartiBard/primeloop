#!/bin/sh
set -e

# Ensure workspace directories exist before starting
mkdir -p "${AGENT_REPO_ROOT:-/workspace/repo}"
mkdir -p "${AGENT_WORKTREE_ROOT:-/workspace/agents}"

# Start codex app-server in the background (connects the Codex LLM locally)
codex app-server &

exec node dist/index.js
