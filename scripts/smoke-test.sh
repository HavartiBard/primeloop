#!/usr/bin/env bash
# smoke-test.sh — fresh-install validation, run before every tester release.
#
#   BASE_URL=http://localhost:3100 ./scripts/smoke-test.sh
#
# Read-only checks always run. To exercise the full setup → Prime round trip
# on a FRESH install (setup not yet complete), provide a provider:
#
#   SMOKE_PROVIDER_TYPE=ollama \
#   SMOKE_PROVIDER_URL=http://host.docker.internal:11434 \
#   SMOKE_PROVIDER_MODEL=qwen2.5:32b \
#   ./scripts/smoke-test.sh
#
# Cloud path: SMOKE_PROVIDER_TYPE=anthropic SMOKE_PROVIDER_MODEL=claude-sonnet-5
# with SMOKE_PROVIDER_KEY (or ANTHROPIC_API_KEY in the backend env).
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3100}"
PASS=0
FAIL=0

# Admin auth: use SMOKE_ADMIN_TOKEN, or fall back to PRIMELOOP_ADMIN_TOKEN
# from ./.env (where install.sh puts it).
ADMIN_TOKEN="${SMOKE_ADMIN_TOKEN:-}"
if [ -z "$ADMIN_TOKEN" ] && [ -f .env ]; then
  ADMIN_TOKEN=$(sed -n 's/^PRIMELOOP_ADMIN_TOKEN=//p' .env | tail -n1)
fi
AUTH_ARGS=()
[ -n "$ADMIN_TOKEN" ] && AUTH_ARGS=(-H "Authorization: Bearer $ADMIN_TOKEN")

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == *"$expected"* ]]; then
    echo "  ok: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name — expected to contain '$expected', got: ${actual:0:200}"
    FAIL=$((FAIL + 1))
  fi
}

echo "── read-only checks ($BASE_URL)"
check "GET /health" '"status":"ok"' "$(curl -s -m 10 "$BASE_URL/health")"
check "GET / serves dashboard" '<title>PrimeLoop</title>' "$(curl -s -m 10 "$BASE_URL/")"
SETUP_STATUS="$(curl -s -m 10 "${AUTH_ARGS[@]}" "$BASE_URL/api/setup/status")"
check "GET /api/setup/status" '"complete"' "$SETUP_STATUS"
check "GET /api/setup/draft" 'function_assignments' "$(curl -s -m 10 "${AUTH_ARGS[@]}" "$BASE_URL/api/setup/draft")"

if [ -z "${SMOKE_PROVIDER_TYPE:-}" ]; then
  echo "── no SMOKE_PROVIDER_* set; skipping live provider + setup round trip"
else
  TYPE="$SMOKE_PROVIDER_TYPE"
  URL="${SMOKE_PROVIDER_URL:-}"
  MODEL="${SMOKE_PROVIDER_MODEL:?SMOKE_PROVIDER_MODEL required}"
  KEY="${SMOKE_PROVIDER_KEY:-}"

  echo "── live provider probe ($TYPE / $MODEL) — may take minutes on a cold local model"
  PROBE=$(curl -s -m 150 "${AUTH_ARGS[@]}" -X POST "$BASE_URL/api/setup/provider-test" \
    -H 'Content-Type: application/json' \
    -d "{\"type\":\"$TYPE\",\"base_url\":\"$URL\",\"api_key\":\"$KEY\",\"model\":\"$MODEL\"}")
  check "provider completion" '"completion_ok":true' "$PROBE"
  check "provider tool call" '"tool_call_ok":true' "$PROBE"

  if [[ "$SETUP_STATUS" == *'"complete":true'* ]]; then
    echo "── setup already complete; skipping setup round trip"
  else
    echo "── completing setup"
    COMPLETE=$(curl -s -m 60 "${AUTH_ARGS[@]}" -X POST "$BASE_URL/api/setup/complete" \
      -H 'Content-Type: application/json' \
      -d "{
        \"providers\": [{\"name\":\"smoke-provider\",\"type\":\"$TYPE\",\"base_url\":\"$URL\",\"api_key\":\"$KEY\",\"model\":\"$MODEL\"}],
        \"routing\": {\"planning\":[{\"provider_name\":\"smoke-provider\",\"model\":\"$MODEL\"}]},
        \"profile\": {\"name\":\"Prime\",\"soul\":{\"identity\":\"Smoke-test Prime\"}},
        \"rules\": {\"presets\":[],\"custom\":\"Smoke test\"},
        \"launch\": true
      }")
    check "POST /api/setup/complete" '"ok":true' "$COMPLETE"

    THREAD_ID=$(printf '%s' "$COMPLETE" | sed -n 's/.*"thread_id":"\([^"]*\)".*/\1/p')
    if [ -n "$THREAD_ID" ]; then
      echo "── Prime round trip (thread $THREAD_ID)"
      SENT_AT=$(date -u +%Y-%m-%dT%H:%M:%S)
      curl -s -m 30 "${AUTH_ARGS[@]}" -X POST "$BASE_URL/api/threads/$THREAD_ID/prime/messages" \
        -H 'Content-Type: application/json' \
        -d '{"content":"Smoke test: reply with a one-line status.","sender":"smoke-test"}' > /dev/null

      REPLY=""
      for _ in $(seq 1 60); do
        REPLY=$(curl -s -m 10 "${AUTH_ARGS[@]}" "$BASE_URL/api/threads/$THREAD_ID/messages" | python3 -c "
import json, sys
sent = '$SENT_AT'
ms = json.load(sys.stdin)
ps = [m for m in ms
      if m.get('role') != 'user'
      and m.get('created_at', '') > sent
      and 'Processing' not in m.get('content', '')[:20]]
print(ps[-1]['content'][:200] if ps else '')" 2>/dev/null)
        [ -n "$REPLY" ] && break
        sleep 5
      done
      if [ -n "$REPLY" ]; then
        echo "  ok: Prime LLM reply — $REPLY"
        PASS=$((PASS + 1))
      else
        echo "  FAIL: Prime LLM reply — no reply within 5 minutes"
        FAIL=$((FAIL + 1))
      fi
    fi
  fi
fi

echo
echo "smoke test: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
