# Prime Agent Implementation Plan

> Source spec: `docs/superpowers/specs/2026-05-09-prime-agent-design.md`
>
> Important scope rule: ignore the older OpenCode Prime-agent-as-worker design. In this plan, Prime is a native backend service, not a row in the `agents` table. Existing `is_prime` and prime-capable agent UI/MCP behavior may remain for backward compatibility, but new Prime Agent work must not depend on it.

## Goal

Replace the regex-based `coordinator.ts` path with a native Prime Agent service that receives chief messages, assembles context, calls an LLM through configured providers, dispatches structured actions, records sessions, and later grows skills, modules, GitOps state, and autonomy.

This plan is optimized for delegation to a local LLM such as GPT-OSS-20B. Each task is intentionally small, file-scoped, and testable. Do not ask a local model to implement multiple phases in one pass.

## Current Repo Baseline

- `backend/src/coordinator.ts` currently classifies chief messages with regex and synchronously creates work/delegation records.
- `backend/src/db.ts` already contains foundation tables for `agent_memories`, `agent_lessons`, `agent_patterns`, and `agent_snapshots`.
- `backend/src/runtime.ts` has useful primitives: `appendThreadMessage`, `createWorkItem`, `updateWorkItem`, `createDelegation`, `insertRuntimeEvent`, and list/query helpers.
- `backend/src/app.ts` registers existing API routers; new Prime routes should be mounted there.
- `backend/src/index.ts` is the backend bootstrap point.
- `backend/package.json` does not yet include Redis/BullMQ/simple-git dependencies.

## Delegation Rules For Local LLM

Give GPT-OSS-20B one task at a time. Include:

- the exact files it may edit
- the exact files it should read first
- the expected tests/build command
- a warning not to modify unrelated UI or OpenCode runtime files

Prefer backend-only tasks until Phase A is stable. Use mocked LLM/queue behavior in tests. Avoid large prompts that include the whole spec.

Important runtime note: local delegate agents are not yet reliable enough to be treated as a fire-and-forget execution substrate. Before Prime depends on them for production delegation, add explicit watchdog semantics around worker start deadlines, heartbeats, task leases, timeout-based requeue, and fallback handling for silent stalls.

Recommended local-model prompt shape:

```text
You are implementing Task A<N> from docs/superpowers/plans/2026-05-09-prime-agent-implementation.md.
Read only the listed context files first.
Edit only the listed target files.
Do not implement future-phase behavior.
Keep changes minimal and add focused tests.
When done, report changed files and test results.
```

## Phase A: Service Skeleton And Reactive Loop

Phase A replaces the coordinator path while keeping risk low. The service should be disabled by default and fall back to the current regex coordinator unless explicitly enabled.

### Task A1: Prime schema and defaults

Purpose: add only the tables needed for Phase A.

Read:
- `backend/src/db.ts`
- `docs/superpowers/specs/2026-05-09-prime-agent-design.md` sections `prime_agent_config` and `prime_agent_sessions`

Edit:
- `backend/src/db.ts`
- `backend/tests/db.test.ts` if schema tests already exist and are easy to extend

Implement:
- `prime_agent_config`
- `prime_agent_sessions`
- indexes from the spec
- seed singleton config row with `enabled = false`

Do not implement:
- skills tables
- module tables
- autonomy tables
- queue mirror table

Acceptance:
- migrations are idempotent
- config row exists after `runMigrations`
- `cd backend && npm run build`
- DB test if available: `cd backend && npm run test:db -- tests/db.test.ts`

### Task A2: Prime config/session service

Purpose: isolate SQL access behind a small service.

Read:
- `backend/src/runtime.ts`
- `backend/src/db.ts`

Create:
- `backend/src/prime-agent/config.ts`
- `backend/src/prime-agent/session.ts`
- `backend/tests/prime-agent/config.test.ts`
- `backend/tests/prime-agent/session.test.ts`

Implement:
- `getPrimeConfig(pool)`
- `updatePrimeConfig(pool, patch)`
- `startPrimeSession(pool, input)`
- `completePrimeSession(pool, id, patch)`
- `failPrimeSession(pool, id, error)`
- `listPrimeSessions(pool, limit?)`

Acceptance:
- functions return typed objects
- tests cover create/update/complete/fail paths
- `cd backend && npm run test:db -- tests/prime-agent/config.test.ts tests/prime-agent/session.test.ts`

### Task A3: Queue abstraction without service wiring

Purpose: hide BullMQ behind a narrow interface so tests can use an in-memory queue.

Read:
- `backend/package.json`
- `docs/superpowers/specs/2026-05-09-prime-agent-design.md` event types section

Create:
- `backend/src/prime-agent/events.ts`
- `backend/src/prime-agent/queue.ts`
- `backend/tests/prime-agent/queue.test.ts`

Implement:
- `PrimeEvent` union for Phase A only:
  - `chief.message`
  - `cron.fast`
  - `fleet.delegation.completed`
  - `fleet.delegation.failed`
- `PrimeQueue` interface:
  - `enqueue(event)`
  - `process(handler)`
  - `close()`
- `createInMemoryPrimeQueue()` for tests and local disabled/no-Redis mode

Do not add BullMQ yet unless this task remains small. BullMQ wiring comes later.

Acceptance:
- queue preserves event payloads
- processor receives enqueued events
- tests do not require Redis

### Task A4: Context assembly

Purpose: build the structured context the LLM will see.

Read:
- `backend/src/runtime.ts`
- `backend/src/registry.ts`
- `backend/src/memory-service.ts` if present
- `docs/superpowers/specs/2026-05-09-prime-agent-design.md` context assembly section

Create:
- `backend/src/prime-agent/context.ts`
- `backend/tests/prime-agent/context.test.ts`

Implement:
- `assemblePrimeContext(pool, event)`
- include enabled agents, recent work items, recent delegations, recent runtime events
- include relevant `agent_lessons` if the table exists
- keep result compact: hard-limit each list

Do not implement:
- semantic skill retrieval
- Git reads
- operator model

Acceptance:
- context is deterministic under test data
- function handles empty database gracefully
- no LLM calls in this module

### Task A5: LLM router interface with mock provider

Purpose: define structured decision IO before adding real providers.

Read:
- `backend/src/registry.ts`
- `docs/superpowers/specs/2026-05-09-prime-agent-design.md` LLM router section

Create:
- `backend/src/prime-agent/llm-router.ts`
- `backend/tests/prime-agent/llm-router.test.ts`

Implement:
- `PrimeDecision`
- `PrimeAction`
- `LlmRouter` interface
- `createMockLlmRouter(decision)` for tests
- `validatePrimeDecision(value)` with strict allowed action types

Allowed Phase A actions:
- `delegate`
- `update_work_item`
- `request_approval`
- `no_op`

Do not implement:
- real Anthropic/OpenAI/provider HTTP calls
- token accounting beyond accepting optional token counts

Acceptance:
- invalid action types are rejected
- malformed decisions are rejected
- mock router returns a valid decision

### Task A6: Action dispatcher

Purpose: translate Phase A decisions into existing runtime writes.

Read:
- `backend/src/runtime.ts`
- `backend/src/mcp/service.ts` only if approval creation must reuse existing logic

Create:
- `backend/src/prime-agent/actions.ts`
- `backend/tests/prime-agent/actions.test.ts`

Implement:
- `dispatchPrimeActions(pool, ctx, decision)`
- `delegate` creates a work item and delegation
- `update_work_item` updates an existing work item
- `request_approval` creates/records an approval using existing project patterns
- `no_op` logs only
- every dispatched action writes a `runtime_events` row

Do not implement:
- `publish_pattern`
- `update_agent_soul`
- `create_skill`
- `create_module`
- autonomy checks

Acceptance:
- tests verify DB rows for each action
- unsupported action returns a controlled error or failed result

### Task A7: Prime event loop

Purpose: process one event end-to-end with mocked dependencies.

Read:
- `backend/src/prime-agent/context.ts`
- `backend/src/prime-agent/llm-router.ts`
- `backend/src/prime-agent/actions.ts`
- `backend/src/prime-agent/session.ts`

Create:
- `backend/src/prime-agent/event-loop.ts`
- `backend/tests/prime-agent/event-loop.test.ts`

Implement:
- `handlePrimeEvent(pool, event, deps)`
- start session
- assemble context
- call router
- dispatch actions
- complete or fail session
- for `chief.message`, append an assistant message to the thread with a concise summary

Acceptance:
- e2e unit test with mock router and in-memory queue
- session is completed on success
- session is failed on thrown error
- chief thread receives an assistant message

### Task A8: Coordinator shim with fallback

Purpose: make Prime optional and preserve current behavior.

Read:
- `backend/src/coordinator.ts`
- `backend/src/routes/runtime.ts`
- `backend/src/prime-agent/config.ts`
- `backend/src/prime-agent/queue.ts`

Edit:
- `backend/src/coordinator.ts`
- tests that currently cover chief message routing

Implement:
- keep the current regex implementation as an internal fallback function
- if `prime_agent_config.enabled = false`, use fallback unchanged
- if enabled, append the user message, enqueue `chief.message`, return a response shape compatible enough for current API callers
- do not synchronously create work/delegation when Prime is enabled

Acceptance:
- existing coordinator tests pass with Prime disabled
- new test verifies enabled mode enqueues event and does not run regex routing

### Task A9: Prime REST API

Purpose: expose enough UI/control surface for Phase A.

Read:
- `backend/src/app.ts`
- existing route style in `backend/src/routes/*.ts`

Create:
- `backend/src/routes/prime-agent.ts`
- `backend/tests/prime-agent/route.test.ts`

Edit:
- `backend/src/app.ts`

Implement endpoints:
- `GET /api/prime-agent/config`
- `PATCH /api/prime-agent/config`
- `GET /api/prime-agent/sessions`
- `POST /api/prime-agent/events` for manual testing with a Phase A event payload

Acceptance:
- route tests cover config get/update and event enqueue
- bad event payload returns 400

### Task A10: Bootstrap service

Purpose: wire the service in backend startup without making Redis mandatory yet.

Read:
- `backend/src/index.ts`
- `backend/src/app.ts`

Create:
- `backend/src/prime-agent/service.ts`

Edit:
- `backend/src/index.ts`
- `backend/src/app.ts` if deps need queue injection

Implement:
- create Prime service with in-memory queue by default
- start processor only if config is enabled
- expose service dependencies to coordinator/routes
- clean shutdown hook if there is an existing pattern; otherwise implement simple `close()`

Acceptance:
- `cd backend && npm run build`
- backend can start with `prime_agent_config.enabled = false`
- no Redis required in Phase A

## Phase B: Redis/BullMQ And Production Queue

Start this only after Phase A is green.

### Task B1: Add Redis dependencies and compose service

Edit:
- `backend/package.json`
- `docker-compose.yml`
- `docker-compose.prod.yml`
- `.env.example`

Implement:
- add `bullmq` and Redis client dependency selected by current BullMQ docs
- add `REDIS_URL`
- add Redis service to compose files

Acceptance:
- install/build succeeds
- backend still works if `REDIS_URL` is unset and Prime disabled

### Task B2: BullMQ queue implementation

Edit:
- `backend/src/prime-agent/queue.ts`
- `backend/tests/prime-agent/queue.test.ts`

Implement:
- `createBullMqPrimeQueue(redisUrl)`
- use queue name `prime:events`
- keep `PrimeQueue` interface unchanged
- tests may remain in-memory; add integration test only if Redis test infra is reliable

Acceptance:
- no Phase A callers change
- build passes

### Task B3: Queue state mirror

Edit:
- `backend/src/db.ts`
- `backend/src/prime-agent/queue.ts`

Implement:
- `prime_agent_queue_state`
- write pending/processing/completed/failed states around queue handling
- startup recovery can be conservative: mark stale processing jobs failed and rely on runtime_events for later replay

Acceptance:
- queue-state tests prove lifecycle updates

## Phase C: Skills And GitOps

Start only after Phase A and B are stable.

### Task C1: Skills schema and read-only service

Create:
- `backend/src/prime-agent/skills.ts`
- `backend/tests/prime-agent/skills.test.ts`

Edit:
- `backend/src/db.ts`

Implement:
- `prime_agent_skills`
- list/search skills with lexical ranking first
- no Git writes yet

### Task C2: Git store local fixture

Create:
- `backend/src/prime-agent/git-store.ts`
- `backend/tests/prime-agent/git-store.test.ts`

Implement:
- clone/pull/status/read/write/commit against a local bare repo fixture
- prefer `execFile('git', ...)` or `simple-git`, but pick one and keep wrapper narrow

### Task C3: Bootstrap fleet repo

Create seed files under:
- `backend/src/prime-agent/seed-skills/`

Implement:
- initialize empty fleet repo
- write starter skills
- write `fleet/operator-model.md`
- write `fleet/modules.md`
- export current agent `soul` and `system_prompt`

## Phase D: Improvement Modules

### Task D1: Module schema and registry

Implement:
- `prime_agent_improvement_modules`
- module registry CRUD
- due-module detection
- no LLM execution yet

### Task D2: Cost controls

Implement:
- `backend/src/prime-agent/cost-controls.ts`
- fleet daily cap
- per-module cap
- circuit breaker

### Task D3: Built-in modules with mocked LLM

Implement one module per task:
- pattern extraction
- skill refinement
- delegation reflection
- fleet health

Each module should be pure where possible: input context + mocked decision/output handlers.

## Phase E: Autonomy

### Task E1: Autonomy schema and checker

Implement:
- `prime_agent_operator_model`
- `prime_agent_autonomy_log`
- `checkAutonomy(action, context)`
- default tier table

### Task E2: Wire autonomy into dispatcher

Implement:
- all actions pass through autonomy
- escalated actions become approvals
- decisions are logged

### Task E3: Learning from approvals/denials

Implement:
- 3 approvals proposes promotion to auto
- 2 denials logs a self-lesson
- operator-locked overrides win

## Phase F: UI

Do UI after backend APIs exist. Keep pages utilitarian and consistent with current app.

### Task F1: Web API and types

Edit:
- `web/src/api.ts`
- `web/src/types.ts`

Add:
- Prime config/session types
- API functions for config and session list

### Task F2: Prime Config page

Create:
- `web/src/pages/PrimeConfig.tsx`

Edit:
- `web/src/App.tsx`
- `web/src/components/Sidebar.tsx`

Implement:
- enable/disable
- cron interval fields
- provider routing JSON editor or simple table
- status/last error display

### Task F3: Prime Overview page

Create:
- `web/src/pages/PrimeOverview.tsx`

Implement:
- service status
- recent sessions
- recent actions
- pending escalations count once autonomy exists

### Task F4: Skills and Modules pages

Create:
- `web/src/pages/PrimeSkills.tsx`
- `web/src/pages/PrimeModules.tsx`

Implement read-only first. Editing can wait until GitOps write paths are stable.

## Recommended Delegation Order

1. A1 schema
2. A2 config/session services
3. A3 queue abstraction
4. A4 context assembly
5. A5 LLM router interface
6. A6 action dispatcher
7. A7 event loop
8. A8 coordinator shim
9. A9 REST API
10. A10 bootstrap
11. B1-B3 Redis/BullMQ
12. C-F in order

## Implementation Guardrails

- Prime Agent is a backend service, not an `agents` row.
- Keep existing regex coordinator as fallback until Phase A is proven.
- Do not make Redis mandatory before BullMQ wiring is complete.
- Do not call external LLMs in tests.
- Do not store chain-of-thought; store brief reasoning summaries only.
- Do not implement GitOps writes before session logging, dispatch, and fallback behavior are stable.
- Do not let UI work start before backend endpoints exist.

## Phase A Completion Definition

Phase A is complete when:

- `prime_agent_config.enabled = false` preserves current behavior.
- enabling Prime causes chief messages to enqueue `chief.message` events.
- one queued event can be processed through context assembly, mocked LLM decision, action dispatch, and session logging.
- failures are recorded in `prime_agent_sessions`.
- `cd backend && npm run build` passes.
- focused backend tests for config/session/queue/context/router/actions/event-loop/coordinator pass.
