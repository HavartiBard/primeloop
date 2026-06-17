# Agent Harness Design

**Date:** 2026-05-11
**Status:** Draft — pending review

---

## Problem

Phase A delegation to local OpenCode agents surfaced three concrete issues:

1. **Scope drift** — agents read and edited files outside the task boundaries, and implemented future-phase behavior the task explicitly forbade (e.g. shipped a full provider-backed LLM router when Task A5 said "do not implement real provider HTTP calls").
2. **Runaway continuation loops** — `opencode run` auto-fires a continuation prompt after every model response, with no built-in termination. Even on trivial tasks the model keeps getting asked "continue if you have next steps." `steps` limits tool calls only; text-only continuation is unbounded.
3. **No durable progress signal** — Phase A relied on the human reading shell output. There's no structured way for a dispatched task to report progress back to the coordination room or external trackers, and no machine-readable completion signal.

The near-term need is a reliable way to dispatch a scoped task to a local OpenCode agent and get a clean result. The long-term need is the same mechanism, called autonomously by Prime Agent when it decides to delegate.

## Goal

A backend service that:

- Manages a persistent OpenCode server per registered agent, each in its own git worktree
- Accepts a delegation, dispatches it to the appropriate agent's server, waits for completion
- Reports periodic progress back to the coordination thread (and optional external trackers)
- Delivers final results as `fleet.delegation.completed` / `fleet.delegation.failed` events on Prime's event queue
- Imposes hard ceilings (timeout, step count, scope-violation detection) before returning failure

## Non-Goals (this design)

- Replacing OpenCode itself. We use it as the agent runtime.
- Cross-agent coordination (work handoff between agents). That's Prime's responsibility.
- Concurrent task execution on a single agent. One task at a time per agent.
- Remote agents over the network. All agents are local processes for now.

## Why Server Mode, Not `opencode run`

`opencode run` drives the conversation loop itself — after every model response it auto-injects a continuation prompt. There is no setting that makes it return when the model is done; you can only cap tool-call iterations with `steps`, after which it switches to text-only mode and continues looping. For idle or trivial tasks the process never self-terminates.

`opencode serve` exposes an HTTP API where the caller drives the loop:

| | `opencode run` | `opencode serve` |
|---|---|---|
| Continuation | Server auto-fires after every response | Only fires when caller POSTs `/prompt` again |
| Loop control | `steps` (tool calls only) | Caller decides — no auto-loop ever |
| Termination | Never self-terminates | `/wait` returns when model stops; server idles |
| Concurrent sessions | One per process | Many per process |

The relevant endpoints:

- `POST /api/session?directory=<worktree>` — create a session (CWD-scoped)
- `POST /api/session/{id}/prompt` — send the next user message; starts processing
- `POST /api/session/{id}/wait` — blocks until the model stops making tool calls
- `GET /api/session/{id}/message` — read all messages so far (used for progress + final result)
- `POST /api/session/{id}/fork` — branch a session (useful for fresh-context per task)

## Architecture

```
┌────────────────────┐
│  Prime Agent       │
│  (event loop)      │
│                    │
│  dispatchPrime     │
│  Actions("delegate"│──────► creates delegations row (status=queued)
│      ↑             │
│      │             │
│  fleet.delegation. │◄─────── Fleet Executor enqueues on completion
│  completed/failed  │
└────────────────────┘
            │
            │
            ▼
┌────────────────────────────────────────────────────────────┐
│  Fleet Executor (new backend module)                       │
│                                                            │
│  ┌──────────────────┐  ┌──────────────────────────────┐   │
│  │ Process Manager  │  │ Task Dispatcher              │   │
│  │ - boot servers   │  │ - claim next delegation      │   │
│  │ - worktrees      │  │ - format prompt              │   │
│  │ - health checks  │  │ - POST /prompt + /wait       │   │
│  └──────────────────┘  │ - poll progress              │   │
│                        │ - parse TASK COMPLETE result │   │
│                        └──────────────────────────────┘   │
│                                                            │
│  ┌──────────────────┐  ┌──────────────────────────────┐   │
│  │ Progress Reporter│  │ Result Router                │   │
│  │ - poll /message  │  │ - enqueue Prime event        │   │
│  │ - extract        │  │ - update delegation row      │   │
│  │   Progress block │  │ - post to coordination room  │   │
│  │ - post to thread │  │ - optional: external tracker │   │
│  └──────────────────┘  └──────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
            │                              │
            │ HTTP                         │ HTTP
            ▼                              ▼
┌─────────────────────┐         ┌─────────────────────┐
│  OpenCode server    │         │  OpenCode server    │
│  Agent A            │   ...   │  Agent B            │
│  port: 4101         │         │  port: 4102         │
│  cwd: worktree-A/   │         │  cwd: worktree-B/   │
└─────────────────────┘         └─────────────────────┘
```

## Components

### Process Manager (`fleet-executor/process-manager.ts`)

Responsibilities:
- On agent enablement: create a worktree (`worktrees/<agent_id>/`) from `main` and start `opencode serve --port <auto> --cwd <worktree>`.
- On agent disable: stop the server, optionally remove the worktree.
- Health check via `GET /api/session` — restart on failure with exponential backoff.
- Maintain a registry of `{agent_id → {pid, port, worktree_path, last_health_check}}`.

New DB shape (additive — no migration of existing tables):

```sql
CREATE TABLE agent_runtime_state (
  agent_id     TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  pid          INTEGER,
  port         INTEGER,
  worktree_path TEXT,
  status       TEXT NOT NULL DEFAULT 'stopped',   -- stopped | starting | running | failed
  last_error   TEXT,
  started_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Task Dispatcher (`fleet-executor/dispatcher.ts`)

Loop:
1. Poll `delegations` for rows with `status = 'queued'` and `to_agent_id` referencing an agent whose runtime is `running`.
2. Claim the row (`UPDATE ... SET status = 'in_progress' WHERE status = 'queued' RETURNING ...`).
3. Look up the agent's server port.
4. Create a fresh session: `POST /api/session?directory=<worktree>` (fresh context per task — sessions don't accumulate).
5. Format the prompt from `delegation.request` using the task template (see Task Prompt Format below).
6. `POST /api/session/{id}/prompt`.
7. `POST /api/session/{id}/wait` with a configurable timeout (default 600s).
8. On `/wait` return, hand off to Result Router.
9. On timeout or error, mark delegation `failed`, enqueue `fleet.delegation.failed`.

### Progress Reporter (`fleet-executor/progress-reporter.ts`)

Runs alongside `/wait`. Every 30 seconds while a task is in flight:
1. `GET /api/session/{id}/message` — fetch the message list.
2. Find the latest assistant message.
3. Extract the `## Progress` block from the message content (the OpenCode-induced Goal/Progress template format).
4. If changed since last poll, `appendThreadMessage` to the delegation's thread as a progress update.
5. If `delegation.metadata.external_tracker` is configured (`{type: 'gitea', issue_id: ...}` or `{type: 'jira', ticket: ...}`), also POST the update there.

### Result Router (`fleet-executor/result-router.ts`)

When a task completes:
1. Parse the final messages looking for `TASK COMPLETE` block (per AGENTS.md format).
2. If found and clean: enqueue `fleet.delegation.completed` with `{delegation_id, work_item_id, agent_id, result: {changed_files, verification}}`.
3. If not found, or `/wait` errored, or scope-violation detected: enqueue `fleet.delegation.failed` with `{delegation_id, ..., error}`.
4. Update delegation row with final status, result blob, and finished_at.
5. Post a completion summary to the coordination thread.
6. If external tracker configured, post final status there.

### Scope Gate

Before enqueuing `fleet.delegation.completed`, run `git diff --name-only` against the agent's worktree. Compare changed files against `delegation.request.allowed_files`. If any file outside the allow-list was modified, mark as `failed` with `error: "scope violation: <files>"`. The work can still be inspected; we just don't claim it as success.

## Task Prompt Format

The dispatcher composes the prompt from delegation metadata into a structured template:

```
# Task

<delegation.request.title>

## Context

<delegation.request.description>

## Files you may read

<list from delegation.request.read_files>

## Files you may edit

<list from delegation.request.allowed_files>

## Files you may NOT touch

<everything else in the repo>

## Verification

Run: <delegation.request.verification_cmd>

## Completion

Output the TASK COMPLETE block per AGENTS.md and stop.
```

The same template is used whether the dispatcher was triggered by a human (Phase B delegation) or by Prime (autonomous). The delegation row is the contract.

## Integration With Existing Prime

The fleet executor sits **between** Prime's decision and the agent's work:

1. Prime's `dispatchPrimeActions` for `delegate` action — **unchanged**. It creates a work item + delegation row exactly as it does today.
2. Fleet Executor watches delegations, picks them up.
3. Fleet Executor enqueues `fleet.delegation.completed` / `failed` when done.
4. Prime's event loop (already implemented in Phase A) handles those events — **unchanged**.

Nothing in `backend/src/prime-agent/` needs to change. Fleet Executor is purely additive.

## Failure Modes

| Condition | Detection | Response |
|---|---|---|
| Agent server crashed | Health check fails | Restart server, mark in-flight delegations as failed, requeue |
| Task hangs / never completes | `/wait` timeout | Kill session, fail delegation, log timeout error |
| Model produces no `TASK COMPLETE` | Final message scan | Fail delegation with reason "no completion marker" |
| Scope violation | `git diff` post-task | Fail delegation; preserve worktree for inspection |
| OpenCode binary missing | Process spawn error | Mark agent as `failed`, prevent dispatch to it |
| Worktree corruption | Worktree health check | Recreate worktree from main, restart server |

## Phase Breakdown

Tasks are prefixed `H` to avoid collision with the Prime Agent plan's `A` series.

**H1 — AgentHarness interface**: define the abstract `AgentHarness` and `TaskHandle` interfaces in `fleet-executor/harness.ts`. No implementation yet.

**H2 — OpenCode harness implementation**: implement `OpenCodeHarness` against the interface. Spawn `opencode serve`, manage port allocation, expose `dispatch`/`abort`/`close`.

**H2b — Pi harness implementation**: implement `PiHarness` against the same interface. Spawn `pi --mode rpc`, write JSONL prompt commands to stdin, parse stdout for events, signal completion on `agent_end`.

**H3 — Process Manager**: start/stop one harness per agent. Selects implementation by `agents.harness` column. No worktree yet. Status table (`agent_runtime_state`). Includes schema migration to add `harness` column.

**H4 — Worktrees**: create per-agent worktrees, pass `--cwd` to harness.

**H5 — Task Dispatcher (single-shot)**: claim one delegation, format prompt, dispatch, await `done`. No progress reporting yet.

**H6 — Scope Gate**: post-task `git diff` check against `allowed_files`.

**H7 — Result Router**: emit Prime events (`fleet.delegation.completed` / `failed`), update delegation row, post to thread.

**H8 — Progress Reporter**: subscribe to harness events, extract Progress section, post to thread.

**H9 — Health checks + restart**: harness health monitoring, automatic restart.

**H10 — External tracker integration (optional)**: Gitea/Jira posting.

Each task scoped to one or two new files + one test file. Tasks H1, H2 enable all others — they must land first.

## Open Questions

1. Should worktrees be persistent across tasks (faster, but accumulates state) or fresh per task (slower, but cleaner)? Current proposal: persistent per agent, with `git reset --hard origin/main` between tasks.
2. How does Prime know which agent to delegate to? Current `dispatchDelegate` already does capability-based agent selection. Keep that.
3. Should Fleet Executor be in-process with the backend or a separate process? Current proposal: in-process module to keep deployment simple.
4. Session forking vs fresh-create per task — performance vs cleanliness tradeoff. Current proposal: fresh session per task.

## Comparison To Pi Agent Harness

Pi (`pi.dev`, package `@earendil-works/pi-coding-agent`) is a minimal terminal coding harness with three programmatic interfaces: an in-process SDK (`createAgentSession()`), a JSONL-over-stdio RPC mode (`pi --mode rpc`), and a JSON event stream mode (`pi --mode json`).

### Architecture difference in one sentence

OpenCode is a compiled binary that exposes an HTTP server with session/prompt/wait endpoints. Pi is a TypeScript agent with deep extension hooks that speaks JSONL over stdin/stdout (or embeds directly via SDK).

### Where Pi is structurally better for what we're building

**1. Tool-call interception is a first-class hook.**
Pi extensions receive `tool_call` events with mutable input, and can return `{block: true, reason: "..."}` to prevent execution. That means scope enforcement is *preventive* — a `write` to a file outside `allowed_files` can be blocked before it happens, with the agent receiving a tool error it can react to. With OpenCode our scope gate is *detective*: we run `git diff` after the task completes and mark it failed if files outside the allow-list changed. Pi's model is strictly better here.

**2. Completion signal is cleaner.**
Pi emits an explicit `agent_end` event when the agent stops processing. That's a single event to watch for on stdout. OpenCode's `POST /wait` does the same job but adds an HTTP round-trip per task. Equivalent in outcome, simpler in Pi.

**3. Streaming progress without polling.**
Pi emits `tool_execution_start`, `tool_execution_end`, `message_update`, and `turn_end` events as they happen. Our progress reporter could subscribe to those events instead of polling `GET /message` every 30 seconds. Lower latency, lower load on the agent server.

**4. Steering commands built in.**
Pi has `streamingBehavior: "steer"` and `"followUp"` to inject mid-task corrections. Our roadmap eventually wants Prime to nudge a stuck agent ("you've been editing the wrong file") and Pi has that primitive natively. OpenCode does not.

**5. SDK embedding is possible.**
`createAgentSession()` runs Pi in-process. For low-overhead deployment we could eventually skip the subprocess boundary entirely and have the Fleet Executor host the agents directly. OpenCode is a binary — no in-process option.

**6. Lighter weight.**
Pi self-describes as "minimal." Lower memory per agent process means we can run more agents on the same machine.

### Where OpenCode is currently better

**1. Maturity.**
We have OpenCode working with LM Studio, with our config, with the existing project's `AGENTS.md` flow. Pi would be a new integration.

**2. HTTP API is universal.**
OpenCode's REST API is debuggable with curl, inspectable in browser dev tools, language-agnostic. Pi's JSONL-over-stdio works fine but requires implementing a stream parser.

**3. MCP integration is first-class.**
OpenCode is built around MCP. Pi mentions MCP but is less prominent. We have MCP servers configured (`director`, `notion`).

**4. Multi-session per process.**
One OpenCode `serve` could host many sessions. Pi is one process per agent. Not actually a downside for our use case — we want per-agent processes anyway for worktree isolation — but worth noting.

### The harness-agnostic design

Pi and OpenCode both satisfy the same abstract contract for what we're building:

```typescript
interface AgentHarness {
  start(opts: {cwd: string, model: ModelRef}): Promise<void>
  dispatch(task: TaskPrompt): Promise<TaskHandle>
  abort(handle: TaskHandle): Promise<void>
  close(): Promise<void>
}

interface TaskHandle {
  events: AsyncIterable<HarnessEvent>   // tool calls, progress, completion
  done: Promise<TaskResult>             // resolves on agent_end / wait return
}
```

Recommendation: **build the Fleet Executor against this interface, implement OpenCode first** (since it's already working in our environment), but design the boundary so Pi can be a drop-in alternative. The interface naturally maps to both harnesses:

| AgentHarness | OpenCode impl | Pi impl |
|---|---|---|
| `start()` | spawn `opencode serve`, wait for port | spawn `pi --mode rpc` |
| `dispatch()` | `POST /prompt` | write `{type:"prompt", ...}` to stdin |
| `events` | poll `GET /message` | read JSONL from stdout |
| `done` | `POST /wait` | wait for `agent_end` event |
| `abort()` | kill session | write `{type:"abort"}` |
| `close()` | SIGTERM to server | close stdin / SIGTERM |

### Verdict

Implement **both** harnesses in the initial deployment. The interface is the same; the implementations differ only inside their respective adapter modules. Reasons:

- We avoid betting the architecture on either tool's roadmap.
- The two harnesses have complementary strengths (OpenCode: maturity, MCP, HTTP debugging; Pi: tool-call hooks, streaming events, steering). Different agents and different task types will benefit from different harnesses.
- Validating the abstraction against two real implementations forces the interface to actually be agnostic, instead of leaking OpenCode-shaped assumptions.
- Per-agent harness selection (configurable on the `agents` table) lets us A/B compare in production.

The DB shape gains a `harness` column on the `agents` table (`'opencode' | 'pi'`, default `'opencode'`). Process Manager selects the implementation based on that column.
