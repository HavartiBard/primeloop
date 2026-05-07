#!/bin/sh
set -e

# Start codex app-server in the background (connects the Codex LLM locally)
codex app-server &

exec node dist/index.js
