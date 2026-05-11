# Prime Agent — Design Spec

**Date:** 2026-05-09
**Status:** Design approved, ready for implementation planning
**Scope:** System 1 of 2. The companion **Collaboration Layer** spec (bidirectional channels, multi-agent rooms, ticket integrations, webhook ingestion) will be brainstormed separately.

---

## Overview

Replace the existing regex-based `coordinator.ts` with a native AI-powered Prime Agent service that proactively coordinates the agent fleet, develops plans, clears blockers, and continuously improves through learned skills, lessons, and operator preferences. The Prime Agent is a persistent Node.js service running alongside the existing Express backend. It uses the LLM as its reasoning engine, Postgres as the durable record, Redis (via BullMQ) as the job/event queue, and a Git/Gitea repository as the GitOps source of truth for skills and agent configurations.

The control plane's existing data model — work items, delegations, agents, memories, lessons, patterns — already provides everything needed to make the Prime Agent significantly more capable than file-based agents like Hermes. This spec adds the active reasoning layer that has been missing.

---

## Goals

- The Prime Agent acts as the brain of the fleet: routes incoming chief messages, proactively monitors fleet state, develops multi-step plans, dispatches delegations, clears blockers, surfaces escalations.
- Continuous self-improvement via post-delegation reflection, hourly pattern extraction, and a growing library of learned coordination skills.
- Operator preferences and autonomy thresholds learned from interaction history, captured in a live operator model.
- The Prime Agent's capability surface is extensible at runtime via an Improvement Module Registry — the Prime Agent can grow new modules itself.
- Skills, agent configurations, and operator model are version-controlled markdown in a Git repository (GitOps). Full audit trail of fleet evolution lives in git history.
- Multi-provider LLM routing with task-specific model selection and fallback chains.
- Tiered autonomy with learned promotion: actions the operator consistently approves are auto-promoted; consistently denied actions are deprioritised.
- Cost controls: per-module token budgets, fleet daily caps, circuit breakers on repeated failure.

## Non-Goals

- The Prime Agent is **not** an entry in the `agents` table. It is a service module within the control plane backend. The existing `is_prime` flag becomes vestigial (or is repurposed in a later spec for designating a "second-in-command" sub-agent).
- Executable skill creation (Hermes-style code-as-skills) is out of scope. Skills are markdown-based coordination strategies retrieved semantically.
- Bidirectional channel routing (Slack threads, GitHub/Gitea/Jira tickets, multi-agent room presence, @mentions, webhook ingestion) is out of scope. Default visibility goes through the existing Operations Portal discussion rooms only. Full bidirectional channels are System 2.
- Multiple backend instance deployment is out of scope (single-instance assumed). Redis is included in the architecture so that scaling out later does not require retrofitting.
- Replacing existing sub-agent runtimes (codex, langgraph, opencode, hermes, raclette) is out of scope. They continue to operate as the work pool under the Prime Agent's coordination.

---

## Phases

The implementation is delivered in three phases. Each phase is independently deployable and adds value on its own.

### Phase A — Service Skeleton & Reactive Loop

The minimum viable Prime Agent. Replaces the existing coordinator.

- `backend/src/prime-agent/` directory scaffolding
- BullMQ queues (`prime:events`, `delegation:dispatch`, `delegation:results`)
- Redis added to `docker-compose.yml`
- Persistent service with WebSocket subscription, basic event loop, debounce window
- LLM router with multi-provider routing and fallback
- Context assembly from existing Postgres tables
- Action dispatch (delegate, update work item, request approval) using existing runtime functions
- Chief message handler shim — `coordinator.ts:handleChiefMessage` enqueues a `chief.message` event instead of pattern-matching directly
- Sessions logging (reasoning summary, actions taken, no full transcripts)
- `prime_agent_config` and `prime_agent_sessions` tables only
- Default no-autonomy mode: every non-trivial action requires approval (Phase C adds the autonomy model)

### Phase B — Self-Improvement Infrastructure

The Prime Agent starts learning and growing capabilities.

- GitOps store (`git-store.ts`): clone, pull, commit, push for the configured fleet repo
- Skills library: `skills/` markdown files in the repo, `prime_agent_skills` index in Postgres
- Improvement Module Registry: `prime_agent_improvement_modules` table, `cron.ts` runner
- Four built-in modules: `pattern-extraction`, `skill-refinement`, `delegation-reflection`, `fleet-health`
- Post-delegation reflection event handler
- Cost controls: per-module daily token budgets, fleet daily cap, circuit breaker on consecutive failures
- Bootstrap: seed skills directory shipped with the codebase, first-run wizard exports existing agent souls/instructions to git
- UI: Prime / Skills page (read-only), Prime / Modules page, Prime / Config page

### Phase C — Autonomy & Evolution

The Prime Agent learns operator preferences and grows new modules autonomously.

- `autonomy.ts` tier check before every action
- `prime_agent_autonomy_log` table
- `prime_agent_operator_model` table + `fleet/operator-model.md` in git
- Learning mechanism: 3 consecutive approvals promotes a Tier 3 action to auto; 2 consecutive denials writes a self-lesson
- Prime-grown improvement modules (modules with `created_by: 'prime'`)
- Operator model evolution via slow cron pattern extraction
- UI: Prime / Overview page, Prime / Skills create/edit, autonomy queue on existing Approvals page, full configurability of autonomy thresholds

---

## Architecture

```
                ┌──────────────────────────────────┐
                │       Existing Backend            │
                │ Express, WebSocket Broadcast,     │
                │ Coordinator (becomes shim)        │
                └────────────────┬─────────────────┘
                                 │
                                 │  enqueue events
                                 ▼
              ┌─────────────────────────────────────┐
              │   prime:events  (BullMQ on Redis)   │
              └────────────────┬────────────────────┘
                               │
                               ▼
       ┌────────────────────────────────────────────────┐
       │            Prime Agent Service                  │
       │                                                 │
       │  Event Loop (debounce 10s)                      │
       │      │                                          │
       │      ▼                                          │
       │  Context Assembly  ◄── Postgres (read)          │
       │      │              ◄── Git Repo (read)          │
       │      ▼                                          │
       │  LLM Router  ──► Provider 1 → fallback → ...    │
       │      │                                          │
       │      ▼                                          │
       │  Decision + Reasoning Summary                   │
       │      │                                          │
       │      ▼                                          │
       │  Autonomy Check                                  │
       │      │                                          │
       │      ▼                                          │
       │  Action Dispatch ─► delegation:dispatch queue    │
       │                  ─► Postgres writes               │
       │                  ─► git commits (skills, configs) │
       │                  ─► request_approval (UI)         │
       └────────────────────────────────────────────────┘
                               │
                               ▼
       ┌────────────────────────────────────────────────┐
       │  delegation:dispatch  (BullMQ on Redis)         │
       └────────────────┬────────────────────────────────┘
                        │
                        ▼
              Delegation Worker
                        │
                        ▼ (HTTP via existing adapters)
              Sub-agents (opencode, codex, hermes, langgraph...)
                        │
                        ▼ (HTTP callback)
       ┌────────────────────────────────────────────────┐
       │  delegation:results  (BullMQ on Redis)          │
       └────────────────┬────────────────────────────────┘
                        │
                        └─► back into prime:events
                            (triggers reflection module)
```

**Cron triggers** (`cron.ts`) run on two cadences:
- **Fast** (default 5 min): scan for blockers, stalled work items, expired delegations — enqueues `cron.fast` events
- **Slow** (default 1 hour): runs `inline` improvement modules due to fire — enqueues `cron.slow` events with module identifier

---

## Data Model

All new tables are added in `backend/src/db.ts` migrations. Existing tables (`agents`, `work_items`, `delegations`, `agent_memories`, `agent_lessons`, `agent_patterns`, `runtime_events`) are used without modification.

### `prime_agent_config`

Singleton row, controls all Prime Agent behaviour.

```sql
CREATE TABLE prime_agent_config (
  id                          TEXT PRIMARY KEY DEFAULT 'default',
  enabled                     BOOLEAN NOT NULL DEFAULT false,
  cron_fast_interval_seconds  INT NOT NULL DEFAULT 300,
  cron_slow_interval_seconds  INT NOT NULL DEFAULT 3600,
  debounce_window_ms          INT NOT NULL DEFAULT 10000,
  provider_routing            JSONB NOT NULL DEFAULT '{}',
  cost_controls               JSONB NOT NULL DEFAULT '{}',
  git_store                   JSONB NOT NULL DEFAULT '{}',
  status                      TEXT NOT NULL DEFAULT 'stopped',
  last_started_at             TIMESTAMPTZ,
  last_error                  TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`provider_routing` shape:
```json
{
  "planning":   [{ "provider_id": "...", "model": "claude-opus-4" }, { "provider_id": "...", "model": "gpt-5" }],
  "routing":    [{ "provider_id": "...", "model": "claude-haiku" }],
  "analysis":   [{ "provider_id": "...", "model": "claude-sonnet" }],
  "reflection": [{ "provider_id": "...", "model": "claude-haiku" }],
  "approval":   [{ "provider_id": "...", "model": "claude-sonnet" }]
}
```

`cost_controls` shape:
```json
{
  "fleet_daily_token_cap": 10000000,
  "default_module_daily_token_cap": 500000,
  "circuit_breaker_consecutive_failures": 3,
  "circuit_breaker_pause_minutes": 60
}
```

`git_store` shape:
```json
{
  "provider": "gitea",
  "url": "https://gitea.example.com/org/fleet-config",
  "token_env": "FLEET_GIT_TOKEN",
  "branch": "main",
  "local_path": "/workspace/fleet-config",
  "auto_commit": true,
  "commit_author": "Prime Agent <prime@fleet>",
  "pull_interval_seconds": 900
}
```

### `prime_agent_skills`

Index of skill markdown files in the git repo. Content is read from disk; embedding and metadata live here for fast retrieval.

```sql
CREATE TABLE prime_agent_skills (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  category        TEXT NOT NULL,
  file_path       TEXT NOT NULL UNIQUE,
  git_sha         TEXT,
  trigger_context TEXT,
  outcome         TEXT,
  embedding       vector(384),
  use_count       INT NOT NULL DEFAULT 0,
  last_used_at    TIMESTAMPTZ,
  created_by      TEXT NOT NULL DEFAULT 'system' CHECK (created_by IN ('system', 'prime', 'operator')),
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_prime_agent_skills_embedding ON prime_agent_skills USING hnsw (embedding vector_cosine_ops);
```

### `prime_agent_improvement_modules`

Registry of recurring intelligence work units.

```sql
CREATE TABLE prime_agent_improvement_modules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL UNIQUE,
  description           TEXT NOT NULL,
  trigger_type          TEXT NOT NULL CHECK (trigger_type IN ('cron', 'event', 'threshold')),
  cadence_cron          TEXT,
  trigger_config        JSONB NOT NULL DEFAULT '{}',
  execution_mode        TEXT NOT NULL CHECK (execution_mode IN ('inline', 'delegate')),
  delegate_capability   TEXT,
  context_spec          JSONB NOT NULL DEFAULT '[]',
  output_handlers       JSONB NOT NULL DEFAULT '[]',
  daily_token_budget    INT,
  consecutive_failures  INT NOT NULL DEFAULT 0,
  paused_until          TIMESTAMPTZ,
  enabled               BOOLEAN NOT NULL DEFAULT true,
  created_by            TEXT NOT NULL DEFAULT 'system' CHECK (created_by IN ('system', 'prime', 'operator')),
  last_run_at           TIMESTAMPTZ,
  next_run_at           TIMESTAMPTZ,
  run_count             INT NOT NULL DEFAULT 0,
  last_outcome          JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `prime_agent_operator_model`

Singleton, learned operator preferences and autonomy overrides.

```sql
CREATE TABLE prime_agent_operator_model (
  id                  TEXT PRIMARY KEY DEFAULT 'default',
  preferences         JSONB NOT NULL DEFAULT '{}',
  autonomy_overrides  JSONB NOT NULL DEFAULT '{}',
  approval_history    JSONB NOT NULL DEFAULT '{}',
  natural_language    TEXT NOT NULL DEFAULT '',
  git_file_path       TEXT NOT NULL DEFAULT 'fleet/operator-model.md',
  git_sha             TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `prime_agent_autonomy_log`

Every autonomous-vs-escalated decision the Prime Agent makes.

```sql
CREATE TABLE prime_agent_autonomy_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID REFERENCES prime_agent_sessions(id) ON DELETE SET NULL,
  action_type         TEXT NOT NULL,
  action_payload      JSONB NOT NULL,
  proposed_tier       INT NOT NULL,
  effective_tier      INT NOT NULL,
  decision            TEXT NOT NULL CHECK (decision IN ('auto', 'escalated', 'approved', 'denied')),
  reason              TEXT,
  operator_feedback   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at          TIMESTAMPTZ
);
CREATE INDEX idx_prime_agent_autonomy_log_action_decision ON prime_agent_autonomy_log (action_type, decision, created_at DESC);
```

### `prime_agent_sessions`

LLM conversation sessions — reasoning summary and actions only, no full transcripts.

```sql
CREATE TABLE prime_agent_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type       TEXT NOT NULL CHECK (trigger_type IN ('event', 'cron_fast', 'cron_slow', 'chief_message')),
  trigger_payload    JSONB NOT NULL,
  module_name        TEXT,
  reasoning_summary  TEXT,
  actions_taken      JSONB NOT NULL DEFAULT '[]',
  token_count        INT NOT NULL DEFAULT 0,
  provider_used      TEXT,
  model_used         TEXT,
  status             TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'escalated')),
  error              TEXT,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ
);
CREATE INDEX idx_prime_agent_sessions_started_at ON prime_agent_sessions (started_at DESC);
```

A daily cron deletes sessions older than 30 days.

### `prime_agent_queue_state`

Postgres mirror of in-flight Redis jobs for crash recovery. BullMQ jobs persist in Redis natively, but if Redis is wiped, this table allows the Prime Agent to re-derive what was in flight.

```sql
CREATE TABLE prime_agent_queue_state (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name   TEXT NOT NULL,
  job_id       TEXT NOT NULL,
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (queue_name, job_id)
);
CREATE INDEX idx_prime_agent_queue_state_status ON prime_agent_queue_state (status, created_at);
```

Job lifecycle: `pending` on enqueue, `processing` on consumer pickup, `completed` or `failed` on finish. On Prime Agent service startup, any rows in `processing` are re-evaluated against `runtime_events` to determine if the work actually completed (and update accordingly) or needs to be re-enqueued.

---

## Service Internals

```
backend/src/prime-agent/
├── service.ts          — bootstrap, lifecycle, wires everything together
├── event-loop.ts       — BullMQ consumer for prime:events, debounce window, dispatch
├── cron.ts             — fast and slow schedules, module runner
├── context.ts          — assembles fleet snapshot from Postgres + git
├── llm-router.ts       — multi-provider routing with fallbacks, task-type dispatch
├── actions.ts          — action dispatch using existing runtime functions
├── autonomy.ts         — tiered autonomy check before every action
├── skills.ts           — skill retrieval (semantic), creation, refinement
├── operator-model.ts   — reads/updates operator preferences and autonomy history
├── session.ts          — session logging
├── git-store.ts        — clone, pull, commit, push, file I/O
├── modules/
│   ├── registry.ts     — module loading, scheduling, execution
│   ├── pattern-extraction.ts
│   ├── skill-refinement.ts
│   ├── delegation-reflection.ts
│   └── fleet-health.ts
└── cost-controls.ts    — token budget tracking, circuit breaker
```

### Event types on `prime:events`

| Event | Source | Triggers |
|---|---|---|
| `chief.message` | Coordinator shim | Operator message in Operations Portal |
| `cron.fast` | `cron.ts` fast scheduler | Every `cron_fast_interval_seconds` |
| `cron.slow` | `cron.ts` slow scheduler | Every `cron_slow_interval_seconds`, payload includes module name |
| `fleet.delegation.completed` | WS broadcast | Sub-agent completed a delegation |
| `fleet.delegation.failed` | WS broadcast | Sub-agent failed a delegation |
| `fleet.work.blocked` | WS broadcast | Work item moved to blocked state |
| `fleet.approval.needed` | WS broadcast | Approval requested by sub-agent |
| `fleet.approval.decided` | WS broadcast | Operator approved/denied something |
| `fleet.agent.offline` | Heartbeat watcher | Agent missed N heartbeats |
| `fleet.event.threshold` | Threshold watcher | A threshold-triggered module fires |

### Context assembly

`context.ts` exports `assembleContext(triggerEvent)` returning a structured context bundle:

```typescript
interface PrimeContext {
  trigger: { type: string; payload: Record<string, unknown> }
  fleet: {
    agents: AgentSnapshot[]      // enabled agents + health + capabilities
    workItems: WorkItemSummary[] // by status, last 24h or active
    delegations: DelegationSummary[] // last 24h with outcomes
  }
  skills: SkillReference[]        // top N retrieved semantically vs trigger
  operatorModel: OperatorModelSnapshot
  recentEvents: RuntimeEvent[]    // last 50 from runtime_events
  recentLessons: AgentLesson[]    // last 10 relevant to trigger
}
```

The trigger type determines which fields are emphasised in the LLM prompt. For `chief.message`, the operator's text is foregrounded; for `cron.slow`, the module's `context_spec` controls what gets prioritised.

### LLM router

Reads `provider_routing` from `prime_agent_config`. Each task type has an ordered fallback list. Tries primary; on error, timeout (default 60s), or rate limit, falls down the list. Logs every attempt to `prime_agent_sessions`. Token count returned by each provider's API is summed into the session's `token_count` field for cost tracking.

LLM calls use structured output (JSON mode) with a strict schema for the decision:

```typescript
interface PrimeDecision {
  reasoning: string                    // brief chain of thought, ≤ 500 chars
  actions: PrimeAction[]               // ordered list to dispatch
  skills_used: string[]                // skill ids referenced in reasoning
  skills_to_create?: SkillProposal[]   // new skills proposed
  operator_model_updates?: object      // proposed updates to preferences
}

interface PrimeAction {
  type: 'delegate' | 'update_work_item' | 'request_approval' | 'publish_pattern'
      | 'update_agent_soul' | 'create_skill' | 'create_module' | 'no_op'
  payload: Record<string, unknown>
  reason: string
}
```

### Action dispatch

`actions.ts` translates each `PrimeAction` into existing runtime function calls:
- `delegate` → `createWorkItem` + `createDelegation` + enqueue `delegation:dispatch`
- `update_work_item` → `updateWorkItem`
- `request_approval` → `ensurePendingApproval` + `runtime_events` insert
- `publish_pattern` → existing `publishPattern` MCP service function (called directly, not via MCP)
- `update_agent_soul` → `updateAgent({ soul })` + git commit if GitOps enabled
- `create_skill` → write markdown file to git, commit, push, insert `prime_agent_skills` row
- `create_module` → insert `prime_agent_improvement_modules` row, append to `fleet/modules.md`, commit
- `no_op` → log only, no side effects

Every action passes through `autonomy.ts` first. If the autonomy check escalates, the action becomes a pending approval and is logged to `prime_agent_autonomy_log` with `decision: 'escalated'`.

---

## GitOps Layer

### Repository structure

```
fleet-config/
├── agents/
│   ├── {agent-name}/
│   │   ├── agent.md          # capabilities, type, endpoint, execution mode (YAML frontmatter + markdown notes)
│   │   ├── soul.md           # identity and values (markdown)
│   │   ├── instructions.md   # operating instructions / system prompt (markdown)
│   │   └── mcp.md            # MCP server assignments (YAML frontmatter listing server ids)
├── skills/
│   ├── {category}/
│   │   └── {skill-name}.md   # YAML frontmatter (title, category, trigger_context, outcome) + markdown body
├── fleet/
│   ├── patterns.md           # best practices and antipatterns (markdown sections)
│   ├── operator-model.md     # YAML frontmatter (autonomy_overrides, preferences) + markdown body
│   └── modules.md            # YAML frontmatter listing module configs + markdown descriptions
└── README.md
```

### File formats

**Skill file** (`skills/coordination/exploration-before-implementation.md`):
```markdown
---
title: Exploration before implementation
category: coordination
trigger_context: implementation delegation requested after a prior failure
outcome: reduces implementation failure rate on complex tasks
created_by: prime
---

When an implementation delegation has previously failed, request a code-exploration delegation first. Pass the exploration result as additional context to the implementation agent on the second attempt.
```

**Operator model** (`fleet/operator-model.md`):
```markdown
---
autonomy_overrides:
  soul_update: auto
  new_agent_creation: always_ask
preferences:
  communication_style: concise
  timezone: Australia/Sydney
  active_hours: "08:00-22:00"
---

# Operator Model

The operator prefers concise status updates without verbose reasoning. Approves research delegations readily, skeptical of speculative refactoring work items. Consistently approves SRE post-mortems after failures.

## Recent Patterns
...
```

**Module registry** (`fleet/modules.md`):
```markdown
---
modules:
  - name: pattern-extraction
    trigger_type: cron
    cadence_cron: "0 * * * *"
    execution_mode: inline
    daily_token_budget: 200000
  - name: sre-post-mortem
    trigger_type: event
    trigger_config: { event_type: fleet.delegation.failed }
    execution_mode: delegate
    delegate_capability: analysis
    created_by: prime
---

# Improvement Modules

Documentation of each registered module follows...
```

### Sync flow

**On startup** (`git-store.ts` invoked from `service.ts`):
1. If `local_path` does not exist, clone repo
2. Otherwise pull latest from `branch`
3. Walk `skills/` — for each `.md`, upsert `prime_agent_skills` by `file_path`. If `git_sha` changed, recompute embedding from file content.
4. Walk `agents/` — for each agent dir, reconcile `soul.md` and `instructions.md` into `agents` table. New dirs in git that have no DB row require operator action (surfaced in UI).
5. Load `fleet/operator-model.md` into `prime_agent_operator_model`
6. Load `fleet/modules.md` and reconcile against `prime_agent_improvement_modules`

**On Prime Agent commits:**
1. Write or modify file in `local_path`
2. Stage, commit with structured message: `{type}({scope}): {summary}` (e.g. `skill(coordination): add exploration-before-implementation`)
3. Push to remote branch
4. Update DB row inline (no need to wait for next sync)

**Periodic pull** (`pull_interval_seconds`, default 15 min):
1. `git pull --ff-only`
2. If conflicts (operator pushed concurrently) — log warning, skip pull, surface in UI
3. If new SHAs — re-walk and reconcile changed files only

### Conflict handling

The Prime Agent uses a single shared branch (default `main`). All Prime Agent commits are linear (no branching). If an operator pushes concurrently and a conflict occurs, the Prime Agent pauses commits, surfaces a "Git sync conflict" alert in the UI, and waits for operator resolution. This is the simplest model and acceptable given low expected concurrency.

For higher concurrency in the future, the Prime Agent could push to a `prime-agent` branch and open PRs to `main`.

---

## Improvement Module System

### Built-in modules (Phase B)

**`pattern-extraction`** — hourly inline
- Context: last 24h of `agent_lessons`, `prime_agent_autonomy_log`, `delegations` (status=completed|failed)
- LLM task: identify recurring patterns; output is a list of new/refined skills + operator model updates
- Output handlers: `create_skill`, `update_operator_model`, `publish_pattern`

**`skill-refinement`** — hourly inline
- Context: all `prime_agent_skills` rows + their use_count and last_used_at
- LLM task: identify skills to deprecate (unused 30+ days), merge near-duplicates (semantic similarity > 0.92), refine skills associated with recent failures
- Output handlers: `update_skill`, `deprecate_skill`, `merge_skills`

**`delegation-reflection`** — event-triggered (`fleet.delegation.completed`, `fleet.delegation.failed`)
- Context: the original delegation + outcome + any sub-agent feedback
- LLM task: did this go well? was the routing right? skill or lesson to capture?
- Output handlers: `create_skill`, `log_lesson`, `update_agent_soul`

**`fleet-health`** — daily inline (slow cron)
- Context: agent heartbeats (last 24h), loop warnings, stalled work items
- LLM task: identify unhealthy agents, recurring loop patterns, work items stuck in approval
- Output handlers: `request_approval` (for restarting agents), `update_work_item`, `create_module` (proposes a `created_by: prime` module if a recurring failure mode warrants it)

### Module runner

Lives in `cron.ts` and `modules/registry.ts`:

1. On `cron.slow` tick, query `prime_agent_improvement_modules` where `enabled = true AND (next_run_at <= now() OR next_run_at IS NULL)`
2. For each due module:
   - Check cost controls: skip if module's daily token usage exceeds `daily_token_budget`, or if circuit breaker is paused (`paused_until > now()`)
   - For `inline` execution: assemble context per `context_spec`, call LLM router with task type `analysis`, run output handlers
   - For `delegate` execution: create work item, enqueue delegation to `delegate_capability`, register a callback so the module's output handlers run when `delegation:results` returns
3. Update `last_run_at`, compute `next_run_at` from `cadence_cron`, update `run_count`, store outcome in `last_outcome`
4. On failure: increment `consecutive_failures`. If exceeds `circuit_breaker_consecutive_failures`, set `paused_until = now() + circuit_breaker_pause_minutes`

### Prime-grown modules (Phase C)

When the Prime Agent identifies a recurring pattern in pattern-extraction or fleet-health that warrants periodic attention, it proposes a new module via the `create_module` action:
1. Action passes through autonomy check (Tier 3 by default)
2. If approved (or auto-approved via learned threshold) — insert row with `created_by: 'prime'`, append to `fleet/modules.md`, commit to git
3. Module runner picks it up on next slow tick

---

## Autonomy Model

### Default tiers

| Tier | Default behaviour | Action types |
|---|---|---|
| 1 | Always auto | memory_store, lesson_log, skill_retrieve, run_reflection, no_op, log_session |
| 2 | Auto unless restricted | publish_pattern, update_own_soul, update_work_item, create_skill, commit_to_git, log_lesson_for_subagent |
| 3 | Approval by default, learns to auto | update_agent_soul (other agent), update_agent_capabilities, create_module, dispatch_to_new_agent_type, deprecate_skill |
| 4 | Always ask, never learns | create_agent, delete_agent, change_provider_config, delete_skill, modify_autonomy_thresholds, modify_cost_controls |

### Learning mechanism (`autonomy.ts`)

Every Phase C action passes through:

```typescript
function checkAutonomy(action: PrimeAction, ctx: PrimeContext): AutonomyDecision {
  const proposedTier = TIER_DEFAULTS[action.type]
  const override = ctx.operatorModel.autonomy_overrides[action.type]

  // Operator-locked overrides win
  if (override === 'always_ask') return { decision: 'escalated', tier: 4 }
  if (override === 'auto') return { decision: 'auto', tier: 1 }

  // Learned promotion
  if (proposedTier === 3) {
    const recent = lastNAutonomyLogs(action.type, 5)
    const consecutiveApprovals = countConsecutive(recent, 'approved')
    const consecutiveDenials = countConsecutive(recent, 'denied')

    if (consecutiveApprovals >= 3) return { decision: 'auto', tier: 2 }
    if (consecutiveDenials >= 2) return {
      decision: 'escalated',
      tier: 3,
      writeLesson: `Operator consistently declines ${action.type}. Reconsider proposing this.`
    }
    return { decision: 'escalated', tier: 3 }
  }

  return { decision: proposedTier <= 2 ? 'auto' : 'escalated', tier: proposedTier }
}
```

After **3 consecutive approvals** of the same `action_type`, the operator model is updated with `autonomy_overrides[action_type] = 'auto'` (this update itself is Tier 4 → requires operator confirmation in UI; offered as a "Promote this to auto?" prompt the next time the action arises).

After **2 consecutive denials**, the Prime Agent writes a lesson to `agent_lessons` for itself: "operator consistently declines X". Future LLM calls see this in context and weight against proposing the action.

### Operator overrides

The Prime / Config UI lets the operator explicitly set any action type to `auto`, `always_ask`, or `learn`. Operator-locked values are never overridden by learning.

---

## Cost Controls (`cost-controls.ts`)

### Token tracking

Every LLM call returns prompt + completion token counts. Recorded in:
- `prime_agent_sessions.token_count` (per session)
- A daily-rolling tally per module in memory, persisted to `prime_agent_improvement_modules.last_outcome.tokens_today`
- A daily-rolling fleet tally in memory, persisted to `prime_agent_config.last_outcome` (or a separate stats table — TBD during implementation)

### Budget enforcement

Before each LLM call:
1. Check fleet daily cap from `prime_agent_config.cost_controls.fleet_daily_token_cap`. If exceeded, refuse the call, log to session as `failed`, escalate as approval if it's a critical event-triggered call.
2. If the call is module-driven, check `daily_token_budget` for the module. If exceeded, skip the module run, log warning.

### Circuit breaker

Per-module counter of `consecutive_failures` (failure = LLM error, timeout, invalid JSON, or action handler exception). When threshold met:
- Set `paused_until = now() + circuit_breaker_pause_minutes`
- Module runner skips while paused
- After pause expires, counter resets and the module retries on next tick
- Operator notified in Prime / Modules UI

---

## Bootstrapping

### Initial state

A new control plane install with the Prime Agent enabled:
1. `prime_agent_config` row inserted with `enabled = false` and default cron intervals
2. Operator opens Prime / Config UI to configure git store and provider routing, then enables
3. First-run wizard launches:
   - Validates git store connection (clones repo if exists, offers to initialise empty repo if not)
   - If repo is empty:
     - Seeds `skills/` with 5 starter coordination strategies (shipped in `backend/src/prime-agent/seed-skills/`)
     - Seeds `fleet/operator-model.md` with empty defaults
     - Seeds `fleet/modules.md` with the four built-in modules
     - Exports each existing agent's `soul` and `system_prompt` from DB into `agents/{name}/soul.md` and `agents/{name}/instructions.md`
     - Initial commit: `chore: initialize fleet configuration`
4. Validates provider routing (each task type has at least one provider configured)
5. Prime Agent service starts, status updates to `running`

### Seed skills

Five starter coordination strategies shipped in the codebase:
- `skills/coordination/route-by-capability.md` — match work to agent capabilities first, fall back to type
- `skills/coordination/exploration-before-implementation.md`
- `skills/coordination/verify-after-implementation.md` — always pair implementation delegations with a verification follow-up
- `skills/recovery/escalate-after-two-failures.md` — surface to operator after a delegation has failed twice
- `skills/recovery/check-blockers-before-routing.md` — check work item `blocked_by` field before creating new delegations

These are committed to the operator's git repo on first run, then maintained by the Prime Agent.

---

## UI

A new **Prime** section in the sidebar containing four pages.

### Prime / Overview (Phase C)
- Service status card: running/stopped/error, uptime, last started, last error
- Current activity card: active session if any, current module running, queue depth on `prime:events`
- Recent decisions feed: last 20 sessions, each showing trigger, reasoning summary, actions taken, link to autonomy log
- Metrics strip: delegations created today, skills used (top 5), tokens spent today vs cap, autonomy escalations pending

### Prime / Skills (Phase B read-only, Phase C edit)
- Grid of skill cards from `prime_agent_skills`, grouped by category
- Card shows: title, category, use count, last used, trigger context preview, `created_by` badge
- Click to read full markdown file content
- Phase C: edit, deprecate, delete (each commits to git)
- "New Skill" button (Phase C, operator authoring)

### Prime / Modules (Phase B)
- Table of all registered modules
- Columns: name, trigger type, cadence/event, execution mode, last run, next run, last outcome (success/failure/paused), tokens today / budget
- Toggle: enable/disable
- "Run now" button per module
- `created_by: prime` badge for prime-grown modules
- "New Module" form (operator-authored, Phase C)

### Prime / Config (Phase A basic, Phase B+C extended)
- Phase A: enable/disable toggle, fast/slow cron intervals, provider routing table (one row per task type with ordered provider+model fallbacks)
- Phase B: git store config (provider, URL, token reference, branch, local path, auto-commit, "Sync now" button, last sync time)
- Phase B: cost controls (fleet daily cap, default module cap, circuit breaker thresholds)
- Phase C: autonomy overrides table (per action type: auto / always_ask / learn)

### Approvals page extension (Phase C)
- New section: "Prime Agent Autonomy Queue"
- Each pending Tier 3 action shows: action type, prime agent reasoning, proposed change (target agent, change diff, etc.), Approve / Deny buttons, optional feedback textarea
- Denied actions with feedback contribute to operator model on next pattern extraction run

---

## Migration Path

### Existing coordinator → Prime Agent

The current `coordinator.ts:handleChiefMessage` does pattern-matching routing inline. It is replaced as follows:

1. **Phase A** — `handleChiefMessage` keeps its existing signature for API compatibility but its body becomes:
   ```typescript
   export async function handleChiefMessage(pool, threadId, content, sender) {
     const userMessage = await appendThreadMessage(pool, threadId, { role: 'user', sender, content, metadata: { source: 'chief-desk' } })
     await enqueuePrimeEvent({ type: 'chief.message', payload: { thread_id: threadId, message_id: userMessage.id, content, sender } })
     return { user_message: userMessage, /* placeholder fields populated by Prime Agent async */ }
   }
   ```
2. The Prime Agent picks up the event, runs context assembly + LLM routing, dispatches actions, and posts a chief response message back to the thread (visible in Operations Portal in real-time via existing WS broadcast).
3. The synchronous return shape changes — callers that expected immediate routing/work_item/delegation in the response now poll the thread for the chief's reply. This is acceptable because the Operations Portal already streams thread messages.

If the Prime Agent service is disabled (`prime_agent_config.enabled = false`), `handleChiefMessage` falls back to the existing regex-based logic. This provides a safety net during rollout.

### Existing agent souls and system prompts → Git

On first sync (Phase B), the bootstrap wizard exports each row from `agents` where `soul IS NOT NULL OR system_prompt IS NOT NULL` into `agents/{name}/soul.md` and `agents/{name}/instructions.md`. The DB columns become a runtime cache; subsequent edits via the UI write to git first then update the DB.

### Existing audit_loops table

The existing `audit_loops` table is unrelated to the Prime Agent's improvement modules. It stays in place for any external scheduled audits. No migration needed.

---

## Testing Strategy

### Unit tests
- `llm-router.ts` — fallback chain behaviour (mock providers that throw, timeout, return invalid JSON)
- `autonomy.ts` — tier promotion logic (3 approvals → auto, 2 denials → lesson)
- `context.ts` — context assembly for each trigger type, structure validation
- `cost-controls.ts` — token counting, cap enforcement, circuit breaker state machine
- `git-store.ts` — clone, pull, commit operations against a local bare repo fixture
- `actions.ts` — each action type translates correctly to existing runtime function calls
- `modules/registry.ts` — module loading, scheduling, due-detection
- Each built-in module — pure function tests with mocked LLM responses

### Integration tests
- End-to-end chief message flow with mocked LLM router returning a fixed `PrimeDecision`
- Module runner full cycle: due module → context assembly → mocked LLM → action dispatch → outcome stored
- GitOps round-trip: prime agent creates skill → file appears on disk → DB row inserted → re-sync produces no diff
- Autonomy flow: action proposed → escalated → approval granted in test → autonomy log row written → on third approval, override updated

### Observability tests
- Verify all sessions are logged regardless of outcome
- Verify all autonomy decisions are logged
- Verify cost tracking matches LLM provider responses

---

## Failure Modes

| Failure | Behaviour |
|---|---|
| LLM provider primary fails | Fall down provider routing list. If all fail: log session as `failed`, optionally escalate as a critical alert if it was an event trigger |
| LLM returns invalid JSON | Retry once with explicit "your previous response was invalid JSON" appended; on second failure, log session as `failed` |
| Git push fails (network) | Retry with exponential backoff (3 attempts). On final failure: warn in UI, leave changes as uncommitted local files, surface "git out of sync" alert |
| Git pull conflict | Pause auto-commits, surface alert in UI, wait for operator resolution |
| Postgres unavailable | Service halts, BullMQ jobs accumulate in Redis. On reconnect, drains queue |
| Redis unavailable | Service halts, restart on reconnect. WS events from this window are recovered from `runtime_events` on startup |
| Sub-agent timeout on delegation | Existing delegation runner handles; timeout becomes `fleet.delegation.failed` event → reflection module fires |
| Module exceeds token budget | Skip module run, log warning. Resets at midnight |
| Circuit breaker tripped | Module paused for `circuit_breaker_pause_minutes`, surfaced in UI |
| Prime Agent service crashes | Restarts via process manager. Re-derives queue state from `prime_agent_queue_state` (mirror table) and `runtime_events`. In-flight session is marked `failed` on startup. |

---

## Open Questions

1. **Token tracking persistence** — should daily token tallies live in their own `prime_agent_token_usage` table, or in `last_outcome` JSONB on `prime_agent_improvement_modules`? Resolved during Phase B implementation.
2. **Embedding model** — `embedding vector(384)` matches the existing `agent_memories` schema. Confirm same embedding model is used for skills (likely yes, for cross-corpus search consistency).
3. **Soul migration during sync conflicts** — if an operator edits an agent's soul in the UI and the Prime Agent edits the same file in git within the pull window, who wins? Proposed: UI edits commit immediately, periodic pull is `--ff-only` so conflicts surface explicitly. Confirm during implementation.
4. **Embedded git CLI vs library** — use `simple-git` npm package (wraps shell git) or call `git` binary via `execFile`. Both work; `simple-git` is more ergonomic, but adds a dependency.

---

## Out of Scope (Future Work)

- **System 2 — Collaboration Layer** — bidirectional channels (Slack threads, GitHub/Gitea/Jira tickets), multi-agent room presence, @mentions, webhook ingestion. Separate brainstorm and spec.
- **Executable skill creation** — Hermes-style code-as-skills. Not in scope; skills remain markdown coordination strategies.
- **Multi-instance backend deployment** — Redis is included so this is possible later, but distributed locking and leader election for the Prime Agent service are out of scope.
- **Cross-fleet learning** — sharing skills or operator models across multiple control plane installations.
- **External Prime Agent (Hermes as Prime via MCP)** — superseded by this native Prime Agent design. The control plane MCP server's prime-only tools become redundant for this Prime Agent (it has direct DB access) but stay available for any external agent the operator wants to designate as a privileged sub-agent.

---

## File Inventory

### New files

```
backend/src/prime-agent/
  service.ts
  event-loop.ts
  cron.ts
  context.ts
  llm-router.ts
  actions.ts
  autonomy.ts
  skills.ts
  operator-model.ts
  session.ts
  git-store.ts
  cost-controls.ts
  modules/
    registry.ts
    pattern-extraction.ts
    skill-refinement.ts
    delegation-reflection.ts
    fleet-health.ts
  seed-skills/
    coordination/route-by-capability.md
    coordination/exploration-before-implementation.md
    coordination/verify-after-implementation.md
    recovery/escalate-after-two-failures.md
    recovery/check-blockers-before-routing.md

backend/src/routes/
  prime-agent.ts          # REST endpoints for UI

backend/tests/prime-agent/
  llm-router.test.ts
  autonomy.test.ts
  context.test.ts
  cost-controls.test.ts
  git-store.test.ts
  actions.test.ts
  modules/registry.test.ts
  modules/pattern-extraction.test.ts
  modules/skill-refinement.test.ts
  modules/delegation-reflection.test.ts
  modules/fleet-health.test.ts
  e2e/chief-message-flow.test.ts
  e2e/module-runner-flow.test.ts
  e2e/gitops-roundtrip.test.ts

web/src/pages/
  PrimeOverview.tsx
  PrimeSkills.tsx
  PrimeModules.tsx
  PrimeConfig.tsx

web/src/hooks/
  usePrimeAgent.ts
  usePrimeSkills.ts
  usePrimeModules.ts
  usePrimeConfig.ts

web/src/api.ts            # extended with prime agent endpoints
web/src/types.ts          # extended with prime agent types
```

### Modified files

```
backend/src/db.ts                        # add migrations for new tables
backend/src/index.ts                     # bootstrap prime agent service
backend/src/coordinator.ts               # convert handleChiefMessage to event enqueuer with fallback
backend/src/app.ts                       # register prime-agent.ts router
backend/package.json                     # add bullmq, simple-git, redis deps
docker-compose.yml                       # add redis service
docker-compose.prod.yml                  # add redis service
.env.example                             # add REDIS_URL, FLEET_GIT_TOKEN, FLEET_GIT_URL

web/src/components/Sidebar.tsx           # add Prime section
web/src/App.tsx                          # add prime routes
web/src/pages/Approvals.tsx              # add Prime Agent autonomy queue section (Phase C)
```
