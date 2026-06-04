# Phase 1 Data Model: Managed-Agent Runtime Alignment

All changes are **idempotent migrations** in `backend/src/db.ts` (per AGENTS.md
migration rules: additive only, no redesign of existing shapes, no extra indexes
beyond those listed). PostgreSQL is the single store of record.

## Changed table: `runtime_events` (session substrate — R1)

Add session grouping + stable intra-session ordering for positional reads.

| Column | Type | Notes |
|--------|------|-------|
| `session_id` | `UUID` (nullable initially, backfilled) | Groups events into one session; = `delegation_id` or `prime_agent_sessions.id` |
| `seq` | `BIGINT` | Monotonic per `session_id`; assigned on insert |

- New index: `UNIQUE (session_id, seq)` — supports `WHERE session_id=$1 AND seq BETWEEN ...` range slices and deterministic replay order.
- Backfill: set `session_id` from `delegation_id` (or thread→prime session) and assign `seq` by `created_at, id` ordering within each session, in a one-time idempotent migration block.
- `seq` assignment: `COALESCE(MAX(seq),0)+1` per session inside `insertRuntimeEvent` (single-writer per session under recovery lock; acceptable for single-tenant scale).

## New table: `brokered_credentials` (R3)

Lifecycle record for every credential issued to an agent. **Secret material is NOT
stored here** — only metadata + a reference into the existing encrypted store.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID PK` | |
| `agent_id` | `UUID REFERENCES agents(id) ON DELETE CASCADE` | Owner |
| `kind` | `TEXT CHECK (kind IN ('provider_proxy_token','gitea_token','named_secret','launcher_token'))` | FR-011; `launcher_token` authenticates the backend→launcher socket (contracts/launcher.md) and rotates like other brokered creds |
| `scope` | `JSONB` | Derived scope (repos, hosts, capabilities) |
| `secret_ref` | `TEXT` | Pointer into encrypted store; never the value |
| `status` | `TEXT CHECK (status IN ('active','rotating','revoked','risky'))` | |
| `auto_rotatable` | `BOOLEAN NOT NULL DEFAULT true` | If false → flagged risky |
| `issued_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `expires_at` | `TIMESTAMPTZ` | ≤24h for durable; = lifespan for ephemeral |
| `rotated_at` | `TIMESTAMPTZ` | |
| `revoked_at` | `TIMESTAMPTZ` | Set synchronously at ephemeral teardown |

- Index: `(agent_id, status)`.
- State transitions: `active → rotating → active`; `active → revoked` (teardown);
  `active → risky` (non-rotatable or past TTL, emits `credential.risk_flagged`).

## New table: `runtime_leases` (R6)

Binds a durable agent's identity to a current (or reclaimable) runtime instance.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID PK` | |
| `agent_id` | `UUID REFERENCES agents(id) ON DELETE CASCADE` | |
| `status` | `TEXT CHECK (status IN ('provisioning','active','idle','reclaimed'))` | |
| `sandbox_id` | `TEXT` | gVisor/runsc instance handle |
| `acquired_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `last_activity_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Idle clock; reclaim after 10 min |
| `released_at` | `TIMESTAMPTZ` | |

- Index: `(agent_id, status)` and `(status, last_activity_at)` for the reclaim sweep.
- One active lease per agent at a time (enforced in `lease.ts` acquire under a row lock).

## New table: `egress_allowlist` (R4)

Per-agent default-deny network egress allowlist.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID PK` | |
| `agent_id` | `UUID REFERENCES agents(id) ON DELETE CASCADE` | |
| `host` | `TEXT NOT NULL` | Allowed destination (host or host:port) |
| `source` | `TEXT CHECK (source IN ('capability','mcp_assignment','operator'))` | Provenance |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

- Index: `UNIQUE (agent_id, host)`.
- Default-deny: absence of a row = blocked. New hosts require `source='operator'` via
  the existing approval queue (no silent insert).

## Reused tables (no shape change)

- `checkpoint_continuations` — already `owner_type='delegation'`, `context_snapshot`,
  `continuation`, `expires_at`, `status`. Used as the resume fallback substrate (R2).
  Add a `recovery_epoch INT NOT NULL DEFAULT 0` column on `delegations` (not here) for
  idempotency.
- `delegations` — add `recovery_epoch INT NOT NULL DEFAULT 0` (idempotency guard, R2).
- `agents` — existing `tier`, `state`, `runtime_family`, `execution_mode`,
  `workspace_root`, `worktree_path`, `local_port` are sufficient; no shape change.
- `agent_tokens` — reused for the control-plane MCP token (now broker-issued, R3).
- `prime_queue_items` — unchanged; its claim pattern (`FOR UPDATE SKIP LOCKED`) is the
  template for the recovery claim.

## Entity → requirement traceability

| Entity / change | Requirements |
|-----------------|--------------|
| `runtime_events.session_id/seq` + `SessionStore` | FR-001, FR-005, FR-006 |
| `delegations.recovery_epoch` + `wake()` | FR-002, FR-003, FR-004, FR-016 |
| `brokered_credentials` | FR-007, FR-009, FR-010, FR-011, SC-002, SC-003 |
| LLM/egress proxy + `egress_allowlist` | FR-008, FR-019, FR-020, FR-021, SC-007 |
| gVisor sandbox + scoped FS (no table) | FR-018, FR-021, FR-022, SC-007 |
| `runtime_leases` | FR-012, FR-013, FR-014, SC-004 |
| Typed `runtime_events` event_types | FR-015 |
