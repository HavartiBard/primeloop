# Prime Agent Loop Closure

**Date:** 2026-05-15
**Status:** Approved — ready for implementation planning
**Depends on:**
- `2026-05-09-prime-agent-design.md` — Phase A service skeleton (implemented)
- `2026-05-11-agent-harness-design.md` — AgentHarness interface + H-task breakdown (interface implemented, H2b–H10 not yet coded)
- `2026-05-11-checkpoint-resume-design.md` — Postgres queue + boot recovery (implemented)

---

## Problem

Phase A of the Prime Agent is fully implemented: the event loop, context assembly, action dispatcher, session logging, and Postgres-backed queue with boot recovery are all wired and running in the production container. However, the agent cannot actually do anything:

1. **No LLM router** — `createUnavailableLlmRouter()` throws on every event. Prime assembles context but cannot make a decision.
2. **No cron trigger** — `cron.fast` event type exists but nothing fires it. Prime only wakes on chief messages or delegation results, neither of which exist yet.
3. **No Pi harness** — `AgentHarness` interface exists (H1 done) but `PiHarness` implementation does not.
4. **No fleet dispatcher** — nothing watches `delegations WHERE status='queued'` and routes them to a harness.
5. **No result router** — nothing emits `fleet.delegation.completed` / `fleet.delegation.failed` back into the prime queue when a harness finishes.

These five items are the complete gap between the current state and a running self-improvement loop.

---

## Goal

Close all five gaps so that:

- Prime fires on a configurable timer, calls a real LLM, and produces `PrimeDecision` objects
- Prime can delegate tasks to Pi harness instances running in the same container
- Delegated agents communicate and post progress back into the coordination thread (visible in the Operations Portal)
- When an agent finishes, the result feeds back into the prime queue and the loop continues
- Optionally, work is also tracked in an external durable tracker (Gitea issues)

---

## Non-Goals

- Redis / BullMQ (Phase B of the prime agent plan) — the Postgres queue is sufficient
- OpenCode harness (H2) — Pi harness (H2b) is the target runtime for self-improvement work
- GitOps layer (Phase C) — skills, operator model, git store are out of scope
- Improvement modules (Phase D) — pattern extraction, delegation reflection, etc.
- Autonomy model (Phase C) — all actions pass through as-is; approval gating is not changed

---

## Architecture

```
container (primeloop backend)
│
├── Prime Agent service
│     every N seconds: enqueue cron.fast
│         │
│         ▼
│     handlePrimeEvent()
│       assemblePrimeContext()
│       configuredLlmRouter.decide()   ← NEW: calls Anthropic/OpenAI API
│       dispatchPrimeActions()
│         └─ delegate → creates work_item + delegation (status=queued)
│
├── Fleet Dispatcher (new)             ← NEW: polls delegations
│     claim queued delegation
│     format prompt
│     piHarness.dispatch(prompt)
│       Pi process (pi --mode rpc)
│         reads/writes worktree files
│         posts JSONL events on stdout
│     progress → appendThreadMessage   (visible in portal)
│     done → scope gate (git diff)
│     → ResultRouter
│
└── Result Router (new)               ← NEW: closes the loop
      update delegation row
      appendThreadMessage (completion summary)
      enqueue fleet.delegation.completed → back into prime queue
      optional: POST to Gitea issue
```

---

## Item 1 — Configured LLM Router

**File:** `backend/src/prime-agent/llm-router.ts` (extend existing)

**New export:** `createConfiguredLlmRouter(pool: pg.Pool): LlmRouter`

### Behaviour

On each `decide(context)` call:

1. Read `prime_agent_config.provider_routing['planning']` from Postgres. If empty or absent, fall back to `provider_routing['routing']`, then to the first provider row in the `providers` table.
2. Iterate the fallback list. For each `{ provider_id, model }`:
   - Fetch the provider row from `providers`
   - Decrypt the API key via `getProviderApiKey(pool, provider_id)`
   - Dispatch based on `provider.type`:
     - `'anthropic'` → Anthropic SDK `messages.create`
     - `'openai'` or `'llm'` → OpenAI SDK with `baseURL: provider.base_url`
   - On any error or timeout (60 s), log the failure and try the next entry
3. If all entries fail, throw — `handlePrimeEvent` catches and fails the session

### Prompt construction

**System prompt** (static per call, constructed from context):

```
You are the Prime Agent — the orchestration brain of an autonomous AI agent fleet.
Your job is to survey fleet state and decide the next actions.

## Fleet

{agents: name, capabilities, enabled — one line each}

## Active Work

{work items: id, title, status, lane — last 20}

## Pending Delegations

{delegations: id, capability, status — last 20}

## Recent Events

{runtime_events: type, actor, summary — last 50}

## Lessons

{agent_lessons relevant to this trigger — up to 10}

## Trigger

{event type and payload}

## Instructions

Respond with a JSON object matching this schema exactly:
{
  "reasoning": "<brief chain of thought, max 500 chars>",
  "actions": [
    {
      "type": "delegate" | "update_work_item" | "request_approval" | "no_op",
      "payload": { ... },
      "reason": "<why>"
    }
  ]
}

For delegate actions, payload must include:
  title, description, capability, allowed_files (array), read_files (array),
  verification_cmd (optional), thread_id (optional).

Keep actions minimal. Prefer no_op if nothing meaningful needs doing.
```

**User message:** `"Survey the fleet and decide your next actions."`

### Token and model tracking

Returned `PrimeDecision` is populated with `provider_used`, `model_used`, and `token_count` from the API response. These are written to `prime_agent_sessions` by the existing `completePrimeSession` call.

### New dependencies

- `@anthropic-ai/sdk`
- `openai`

---

## Item 2 — Cron Timer

**File:** `backend/src/prime-agent/service.ts` (extend existing)

`node-cron` is already installed. In `PrimeAgentService.start()`, after the queue processor is registered, start two interval timers using `cron_fast_interval_seconds` and `cron_slow_interval_seconds` from config:

```typescript
// Use setInterval rather than node-cron for sub-minute granularity
const fastTimer = setInterval(() => {
  void queue.enqueue({
    type: 'cron.fast',
    payload: { triggered_at: new Date().toISOString(), source: 'cron' },
  })
}, config.cron_fast_interval_seconds * 1000)
```

Default `cron_fast_interval_seconds` is 300 (5 minutes). Timers are cleared in `close()`. If `start()` is called multiple times (e.g. on config update), existing timers are cleared before new ones are set.

---

## Item 3 — Pi Harness

**File:** `backend/src/fleet-executor/pi-harness.ts` (new)

Implements the existing `AgentHarness` interface from `fleet-executor/harness.ts`.

### start({ cwd, model })

Spawns `pi --mode rpc` as a child process:

```typescript
this.proc = spawn('pi', ['--mode', 'rpc'], {
  cwd,
  env: { ...process.env, PI_MODEL: model.id, PI_PROVIDER: model.providerID },
  stdio: ['pipe', 'pipe', 'pipe'],
})
```

Reads stdout line-by-line. Waits for `{ type: 'ready' }` JSONL line before resolving. On process exit before ready, throws.

### dispatch(prompt): Promise<TaskHandle>

Writes to stdin:

```jsonl
{ "type": "prompt", "text": "<formatted task>", "allowed_files": [...], "read_files": [...] }
```

Returns a `TaskHandle`:
- `id`: UUID generated locally
- `events`: async iterable that reads JSONL lines from stdout and maps to `HarnessEvent`:
  - `tool_execution_start` → `{ type: 'tool_call_start', tool, args }`
  - `tool_execution_end` → `{ type: 'tool_call_end', tool, result, error }`
  - `message_update` → `{ type: 'message_update', delta }`
  - `agent_end` → `{ type: 'task_end', result }` (terminates the iterable)
- `done`: Promise that resolves with `TaskResult` on `agent_end`, rejects on process error or timeout

### abort(taskId)

Writes `{ "type": "abort" }` to stdin.

### close()

Closes stdin, sends SIGTERM, awaits process exit with 5 s timeout then SIGKILL.

### Process manager extension

`OpenCodeProcessManager` currently only boots `runtime_family === 'opencode'` agents. It must be extended to also handle `runtime_family === 'pi'` agents — spawning `pi --mode rpc` instead of `opencode serve`, and returning a `PiHarness` instance from `getRunningHarness(agentId)`. The dispatcher calls `getRunningHarness` and receives an `AgentHarness` regardless of which harness type backs the agent.

### Container requirement

`pi` must be installed in the Docker image. Add to `Dockerfile`:

```dockerfile
RUN npm install -g @earendil-works/pi-coding-agent
```

---

## Item 4 — Fleet Dispatcher

**File:** `backend/src/fleet-executor/dispatcher.ts` (new)

Polls every 5 seconds (configurable via `FLEET_POLL_INTERVAL_MS` env). Runs in-process alongside the backend.

### Loop

```
while running:
  rows = SELECT * FROM delegations
         WHERE status = 'queued'
         ORDER BY created_at
         LIMIT 10

  for each row:
    claimed = UPDATE delegations SET status='in_progress'
              WHERE id = row.id AND status = 'queued'
              RETURNING *
    if not claimed: skip (race)

    agent = registry.get(claimed.to_agent_id)
    harness = processManager.getRunningHarness(agent.id)  ← Pi or OpenCode, by runtime_family
    if harness not running: requeue (status back to 'queued'), continue

    prompt = formatPrompt(claimed.request)
    handle = await harness.dispatch(prompt)

    for await event of handle.events:
      if event.type === 'progress':
        appendThreadMessage(pool, thread_id, { role:'assistant', content: event.summary })

    result = await handle.done
    → hand to ResultRouter
```

### Prompt format

```
# Task

{delegation.request.title}

## Context

{delegation.request.description}

## Files you may read

{delegation.request.read_files — one per line}

## Files you may edit

{delegation.request.allowed_files — one per line}

## Files you must NOT touch

Everything else in the repository.

## Verification

Run: {delegation.request.verification_cmd}

## Completion

Output the TASK COMPLETE block per AGENTS.md and stop.
```

If `allowed_files` is absent or empty, the scope gate is skipped (unscoped delegation).

### Scope gate

After `handle.done` resolves, runs:

```bash
git -C {worktree_path} diff --name-only HEAD
```

Compares result against `delegation.request.allowed_files`. If any file outside the list was modified, the task is treated as failed with `error: 'scope violation: {files}'`. The worktree is left as-is for inspection.

---

## Item 5 — Result Router

**File:** `backend/src/fleet-executor/result-router.ts` (new)

Called by the dispatcher after `handle.done` settles and scope gate runs.

### On success

```typescript
await pool.query(
  `UPDATE delegations SET status='completed', result=$2, finished_at=now() WHERE id=$1`,
  [delegation.id, JSON.stringify(result)]
)

await appendThreadMessage(pool, thread_id, {
  role: 'assistant',
  sender: agent.name,
  content: `Task complete. Changed: ${result.changed_files?.join(', ') ?? 'none'}`,
})

await primeQueue.enqueue({
  type: 'fleet.delegation.completed',
  payload: {
    delegation_id: delegation.id,
    work_item_id: delegation.work_item_id,
    agent_id: delegation.to_agent_id,
    result: { changed_files: result.changed_files },
  },
})
```

### On failure

```typescript
await pool.query(
  `UPDATE delegations SET status='failed', error=$2, finished_at=now() WHERE id=$1`,
  [delegation.id, error]
)

await appendThreadMessage(pool, thread_id, {
  role: 'assistant',
  sender: agent.name,
  content: `Task failed: ${error}`,
})

await primeQueue.enqueue({
  type: 'fleet.delegation.failed',
  payload: {
    delegation_id: delegation.id,
    work_item_id: delegation.work_item_id,
    agent_id: delegation.to_agent_id,
    error,
  },
})
```

### External tracker (Gitea)

If `delegation.metadata.external_tracker` is set and `GITEA_TOKEN` env is present:

```typescript
if (tracker.type === 'gitea' && process.env.GITEA_TOKEN) {
  await fetch(`${tracker.base_url}/api/v1/repos/${tracker.repo}/issues/${tracker.issue_id}/comments`, {
    method: 'POST',
    headers: {
      Authorization: `token ${process.env.GITEA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body: summaryMarkdown }),
  })
}
```

Gitea posting is best-effort: errors are logged but do not affect the prime queue enqueue.

---

## Container / Compose Changes

### `Dockerfile`

```dockerfile
RUN npm install -g @earendil-works/pi-coding-agent
```

Add after the existing `npm install -g @openai/codex` line.

### `docker-compose.prod.yml` — new environment variables

```yaml
ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
AGENT_REPO_ROOT: /workspace/repo
AGENT_WORKTREE_ROOT: /workspace/agents
GITEA_TOKEN: ${GITEA_TOKEN:-}
```

### `docker-compose.prod.yml` — new volume mounts

```yaml
volumes:
  - /mnt/user/appdata/primeloop/workspace:/workspace
  - /mnt/user/appdata/primeloop/codex:/root/.codex
```

`/workspace/repo` must contain a git checkout of the target repository (the one agents will modify). This volume is bind-mounted so changes made by agents in worktrees persist across container restarts.

### `.env.example`

Add:
```
ANTHROPIC_API_KEY=
GITEA_TOKEN=
AGENT_REPO_ROOT=/workspace/repo
AGENT_WORKTREE_ROOT=/workspace/agents
```

---

## Wiring in `index.ts`

```typescript
// After existing prime agent service setup:
const fleetDispatcher = createFleetDispatcher(pool, processManager, primeAgentService.queue)
fleetDispatcher.start()

// In shutdown:
await fleetDispatcher.stop()
```

`createFleetDispatcher` returns `{ start(), stop() }`. `stop()` clears the poll interval and waits for any in-flight dispatch to finish.

---

## Bootstrap sequence on first run

1. Configure a provider in the UI (Anthropic or LiteLLM proxy) and note the provider ID
2. PATCH `/api/prime-agent/config` with:
   ```json
   {
     "enabled": true,
     "provider_routing": {
       "planning": [{ "provider_id": "<id>", "model": "claude-opus-4-7" }]
     }
   }
   ```
3. Create an agent in the registry with `execution_mode: 'local'`, `runtime_family: 'pi'`
4. Prime fires on next cron tick, assembles context, calls LLM, delegates a task
5. Fleet dispatcher claims the delegation, boots Pi harness, runs the task
6. Result feeds back into prime queue, loop continues

---

## Testing

### Unit

- `llm-router.ts`: mock Anthropic/OpenAI SDK — verify fallback chain fires on error, `provider_used` and `model_used` are populated, invalid JSON response is rejected
- `service.ts`: verify cron timer enqueues `cron.fast` events at the configured interval; timers cleared on `close()`
- `pi-harness.ts`: mock child process with a readable/writable stream pair — verify `dispatch()` writes correct JSONL, `events` iterable emits mapped `HarnessEvent`s, `done` resolves on `agent_end`
- `dispatcher.ts`: mock pool + harness — verify atomic claim (second claim on same row returns null), scope gate rejects out-of-scope files
- `result-router.ts`: mock pool + prime queue — verify delegation row updated, prime event enqueued, Gitea POST called when configured

### Integration (existing DB test infra)

- End-to-end: enqueue `cron.fast` → `handlePrimeEvent` with mock LLM router returning `delegate` action → delegation row created with `status='queued'` → dispatcher claims and dispatches → mock harness resolves → result router enqueues `fleet.delegation.completed` → second `handlePrimeEvent` runs

---

## File Inventory

### New files

```
backend/src/fleet-executor/pi-harness.ts
backend/src/fleet-executor/dispatcher.ts
backend/src/fleet-executor/result-router.ts
backend/tests/prime-agent/llm-router.test.ts          (extend existing)
backend/tests/fleet-executor/pi-harness.test.ts
backend/tests/fleet-executor/dispatcher.test.ts
backend/tests/fleet-executor/result-router.test.ts
```

### Modified files

```
backend/src/prime-agent/service.ts         add cron timers
backend/src/prime-agent/llm-router.ts      add createConfiguredLlmRouter export
backend/src/opencode/process-manager.ts    add Pi harness support (runtime_family='pi')
backend/src/index.ts                       wire FleetDispatcher
backend/package.json                       add @anthropic-ai/sdk, openai
Dockerfile                                 add pi install
docker-compose.prod.yml                    add env vars + volume mount
.env.example                               add new vars
```
