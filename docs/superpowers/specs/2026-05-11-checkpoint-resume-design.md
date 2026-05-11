# Checkpoint / Resume Design

**Date:** 2026-05-11
**Status:** Draft — pending review

---

## Problem

The current runtime has four concrete durability gaps:

1. **Queue loss on restart** — `InMemoryPrimeQueue` is a plain array. Any events in flight when the backend crashes are gone.
2. **Non-resumable sessions** — `handlePrimeEvent` runs `assembleContext → decide → dispatchActions` as one atomic block. A crash partway through forces a full retry including another LLM call.
3. **Approval re-execution** — when Prime creates an approval and returns, the next invocation rebuilds context from scratch and potentially re-calls the LLM to rediscover a decision it already made.
4. **Untyped delegation trace** — `delegations.trace` is `unknown[]`, making it unqueryable and useless for failure diagnosis or agent performance grading.

Additionally, there is no unified view of which agent was performing which action at any point in time.

## Goal

Add durable checkpoint and resume capability to the Agent Control Plane using a targeted addition on top of the existing schema, without duplicating the step-log role already served by `runtime_events`.

Specifically:
- Queue events survive backend restarts and auto-resume on boot
- `handlePrimeEvent` steps are individually checkpointed so partial failures are retried from the failed step, not from scratch
- Approval continuations save the Prime decision; on resolution, context is diffed and the LLM call is skipped if state is unchanged
- `delegations.trace` becomes typed with timing, token counts, and agent attribution
- Both Prime Agent and Fleet Executor write through a single `CheckpointStore` interface
- Every checkpoint record carries `actor_agent_id` enabling full trace from Prime → Fleet Executor → Agent
- Completed continuations are retained permanently (never hard-deleted) to serve the future grading system

## Non-Goals

- A grading or evaluation system (separate spec; depends on this one)
- LangGraph-style full state snapshots after every node — `runtime_events` serves the step-log role
- Cross-agent coordination or work handoff — that remains Prime's responsibility
- UI for reviewing checkpoints — a future concern once grading is designed

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Backend boot                                           │
│  checkpointStore.recoverStaleItems()                    │
│  → resets processing→pending in prime_queue_items       │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Prime Agent service                                    │
│                                                         │
│  PostgresPrimeQueue (prime_queue_items)                 │
│    claimNextItem() → processing                         │
│    completeItem()  → done                               │
│    failItem()      → failed                             │
│                                                         │
│  handlePrimeEvent()                                     │
│    step: assembling_context  ─► runtime_event           │
│    step: deciding            ─► runtime_event           │
│    step: dispatching         ─► runtime_event           │
│      on approval:                                       │
│        saveContinuation(decision + context_snapshot)    │
│      on approval resolve:                               │
│        loadContinuation()                               │
│        contextChanged() ?                               │
│          no  → dispatchActions from blob                │
│          yes → full LLM cycle                           │
└──────────────────────┬──────────────────────────────────┘
                       │                    │
              Prime writes            Fleet writes
                       │                    │
                       ▼                    ▼
┌─────────────────────────────────────────────────────────┐
│  CheckpointStore (backend/src/checkpoint-store.ts)      │
│                                                         │
│  prime_queue_items        checkpoint_continuations      │
│  delegations.trace        (typed DelegationTraceEntry)  │
└─────────────────────────────────────────────────────────┘
```

## Schema

### New table: `prime_queue_items`

Replaces `InMemoryPrimeQueue`. Survives restarts. On boot, any row in `processing` is reset to `pending`.

```sql
CREATE TABLE prime_queue_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type     TEXT NOT NULL,
  payload        JSONB NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
                   -- pending | processing | done | failed
  actor_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  attempt        INT NOT NULL DEFAULT 0,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON prime_queue_items (status, created_at);
```

### New table: `checkpoint_continuations`

Stores resumable blobs for suspended Prime sessions and in-flight Fleet delegations. Rows are never hard-deleted; `status` transitions to `resumed` or `discarded` on resolution.

```sql
CREATE TABLE checkpoint_continuations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type       TEXT NOT NULL CHECK (owner_type IN ('prime_session', 'delegation')),
  owner_id         UUID NOT NULL,
  actor_agent_id   UUID REFERENCES agents(id) ON DELETE SET NULL,
  step             TEXT NOT NULL,
                     -- 'awaiting_approval' | 'dispatch_partial' | etc.
  context_hash     TEXT NOT NULL,
  context_snapshot JSONB NOT NULL,
  continuation     JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
                     -- pending | resumed | discarded
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resumed_at       TIMESTAMPTZ
);

CREATE INDEX ON checkpoint_continuations (owner_id, status);
```

### Column addition: `prime_agent_sessions.last_step`

Tracks which step of `handlePrimeEvent` last completed, enabling step-level retry.

```sql
ALTER TABLE prime_agent_sessions
  ADD COLUMN IF NOT EXISTS last_step TEXT;
  -- 'assembling_context' | 'deciding' | 'dispatching' | 'completed' | 'failed'
```

### Type change: `delegations.trace` (TypeScript only)

No SQL change — `trace` is already `JSONB`. The TypeScript type narrows from `unknown[]` to:

```typescript
export interface DelegationTraceEntry {
  step: 'queued' | 'claimed' | 'prompt_sent' | 'wait_returned'
      | 'scope_checked' | 'result_routed' | 'failed'
  at: string           // ISO timestamp — step started
  completed_at?: string
  actor_agent_id?: string
  tokens?: number
  detail?: Record<string, unknown>
}
```

## CheckpointStore Interface

Lives in `backend/src/checkpoint.ts`. Both Prime Agent and Fleet Executor import from here.

```typescript
import type { PrimeEvent } from './prime-agent/events.js'

export interface CheckpointContinuation {
  id: string
  owner_type: 'prime_session' | 'delegation'
  owner_id: string
  actor_agent_id?: string
  step: string
  context_hash: string
  context_snapshot: Record<string, unknown>
  continuation: Record<string, unknown>
  status: 'pending' | 'resumed' | 'discarded'
  expires_at?: string
  created_at: string
  resumed_at?: string
}

export interface CheckpointStore {
  // Queue — Prime Agent only
  enqueueItem(event: PrimeEvent, actorAgentId?: string): Promise<string>
  claimNextItem(): Promise<{ id: string; event: PrimeEvent } | null>
  completeItem(id: string): Promise<void>
  failItem(id: string, error: string): Promise<void>
  recoverStaleItems(): Promise<number>

  // Continuations — Prime Agent + Fleet Executor
  saveContinuation(opts: {
    owner_type: 'prime_session' | 'delegation'
    owner_id: string
    actor_agent_id?: string
    step: string
    context_snapshot: Record<string, unknown>
    continuation: Record<string, unknown>
  }): Promise<CheckpointContinuation>

  loadContinuation(ownerId: string): Promise<CheckpointContinuation | null>
  markResumed(id: string): Promise<void>
  discardContinuation(id: string): Promise<void>

  // Context diff — pure function, no DB call
  contextChanged(
    saved: CheckpointContinuation,
    fresh: Record<string, unknown>
  ): boolean
}
```

`contextChanged` computes a SHA-256 of the fresh context's material fields (active work item count, pending delegation ids, last event id). If the hash matches `saved.context_hash`, returns false immediately. If hashes differ, performs field-level diff against `context_snapshot` to distinguish material changes (new delegation completed, approval resolved) from noise (timestamp updates). Returns true only for material changes.

## Runtime Behavior

### Boot: auto-resume

Called once during `backend/src/index.ts` startup, before Prime begins processing:

```typescript
const recovered = await checkpointStore.recoverStaleItems()
if (recovered > 0) {
  logger.info(`checkpoint: recovered ${recovered} stale queue items`)
}
```

`recoverStaleItems` runs:

```sql
UPDATE prime_queue_items
SET status = 'pending', updated_at = now()
WHERE status = 'processing'
RETURNING id
```

No human gate. Items returned are picked up in normal `claimNextItem` order.

### `handlePrimeEvent` step checkpointing

`prime_agent_sessions.last_step` is updated at the start of each phase. On retry, the handler reads `last_step` and skips completed phases:

```
start                → last_step = 'assembling_context'
context assembled    → last_step = 'deciding'
decision made        → last_step = 'dispatching'
all actions done     → last_step = 'completed'
any error            → last_step = 'failed'
```

Each phase transition also writes a `runtime_event` (existing mechanism) for the observability log. The `last_step` column is the resume cursor; `runtime_events` remains the audit trail.

### Approval continuation

**On approval creation:**

```typescript
await checkpointStore.saveContinuation({
  owner_type: 'prime_session',
  owner_id: session.id,
  actor_agent_id: primeAgentId,
  step: 'awaiting_approval',
  context_snapshot: {
    active_work_item_count: context.workItems.length,
    pending_delegation_ids: context.delegations.filter(d => d.status === 'queued').map(d => d.id),
    last_event_id: context.recentEvents[0]?.id,
  },
  continuation: { decision },   // full PrimeDecision blob
})
```

**On approval resolution:**

`buildSnapshot` extracts the material fields from a `PrimeContext` into the same shape as `context_snapshot` — it is a pure function defined alongside `assemblePrimeContext` in `context.ts`:

```typescript
export function buildContextSnapshot(context: PrimeContext): Record<string, unknown> {
  return {
    active_work_item_count: context.workItems.length,
    pending_delegation_ids: context.delegations
      .filter(d => d.status === 'queued')
      .map(d => d.id),
    last_event_id: context.recentEvents[0]?.id,
  }
}
```

```typescript
const saved = await checkpointStore.loadContinuation(session.id)
if (!saved) {
  // no continuation — run full cycle
  return handlePrimeEvent(pool, event, deps)
}

const freshContext = await assemblePrimeContext(pool, event)
if (checkpointStore.contextChanged(saved, buildContextSnapshot(freshContext))) {
  await checkpointStore.discardContinuation(saved.id)
  return handlePrimeEvent(pool, event, deps)
}

// context unchanged — skip LLM call
const decision = saved.continuation.decision as PrimeDecision
await checkpointStore.markResumed(saved.id)
return dispatchPrimeActions(pool, freshContext, decision)
```

## Grading-Aware Design Notes

The following decisions were made explicitly to support the future grading system (separate spec):

- `checkpoint_continuations` rows are never hard-deleted. Status transitions to `resumed` or `discarded`. The `continuation` blob (containing `PrimeDecision`, reasoning, context snapshot) is available for grading queries.
- `DelegationTraceEntry` includes `at`, `completed_at`, and `tokens` so the grading system can compute per-step latency and token efficiency without additional instrumentation.
- `prime_agent_sessions` already carries `token_count`, `provider_used`, `model_used`, and `reasoning_summary` — no additions needed for grading to read LLM-level metrics.

The grading system reads from these tables; it does not introduce parallel data collection.

## Failure Modes

| Condition | Detection | Response |
|---|---|---|
| Backend crash with items in queue | `status = 'processing'` on boot | `recoverStaleItems()` resets to `pending` |
| LLM call succeeds, dispatch crashes | `last_step = 'dispatching'` on retry | Re-enter `dispatchPrimeActions`, skip completed actions via runtime_events |
| Approval continuation found but context changed | `contextChanged()` returns true | Discard continuation, run full LLM cycle |
| Continuation missing on approval resolve | `loadContinuation()` returns null | Run full LLM cycle — safe fallback |
| Continuation expired | `expires_at` < now | Treat as discarded, run full cycle |
| DB unavailable on boot recovery | `recoverStaleItems()` throws | Log error, proceed without recovery — items remain `processing` and will be recovered on next boot |
| Item was mid-processing when crash occurred | Reset to `pending` on boot | At-least-once delivery — `handlePrimeEvent` must be idempotent for actions already dispatched; `runtime_events` step log is used to skip completed actions |

## Files

| File | Change |
|---|---|
| `backend/src/db.ts` | Add `prime_queue_items`, `checkpoint_continuations`, `prime_agent_sessions.last_step` migration |
| `backend/src/checkpoint.ts` | New — `CheckpointStore` interface + `DelegationTraceEntry` type |
| `backend/src/checkpoint-store.ts` | New — Postgres implementation of `CheckpointStore` |
| `backend/src/prime-agent/queue.ts` | Replace `InMemoryPrimeQueue` with `PostgresPrimeQueue` backed by `prime_queue_items` |
| `backend/src/prime-agent/context.ts` | Add `buildContextSnapshot()` pure function |
| `backend/src/prime-agent/event-loop.ts` | Add `last_step` tracking, approval continuation save/load/diff |
| `backend/src/index.ts` | Call `recoverStaleItems()` on boot before Prime service starts |
| `backend/tests/checkpoint-store.test.ts` | New — DB integration tests for all `CheckpointStore` methods |
| `backend/tests/prime-agent/event-loop.test.ts` | Extend — cover step retry, continuation replay, context-diff paths |
