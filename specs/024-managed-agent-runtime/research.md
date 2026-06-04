# Phase 0 Research: Managed-Agent Runtime Alignment

All five clarifications were resolved during `/speckit-clarify`, so there are no open
`NEEDS CLARIFICATION` markers. Research below resolves the *technical approach* for
each decision and confirms reuse of existing primitives.

## R1 — Positional session events (FR-005, FR-006)

**Decision**: Add `session_id UUID` and a per-session monotonic `seq BIGINT` to
`runtime_events`. A `SessionStore` exposes `getEvents(sessionId, { from, to, last })`
returning a bounded ordered slice, and `getSession(sessionId)` returning a header +
the merged timeline over `runtime_events` (primary), `thread_messages`,
`delegations.trace`, and `checkpoint_continuations`.

**Rationale**: `runtime_events` is already append-only with the right foreign keys
(`thread_id`, `work_item_id`, `delegation_id`) and a `created_at DESC` index, but has
no session grouping or stable intra-session ordering for slicing. A `(session_id, seq)`
unique key gives O(log n) range reads (`WHERE session_id=$1 AND seq BETWEEN ...`) and
a deterministic replay order independent of `created_at` collisions. The other stores
are folded in by the read model rather than copied, satisfying the "consolidate, don't
duplicate" assumption.

**Alternatives considered**: (a) Order by `created_at, id` only — rejected: timestamp
collisions and no session grouping make slicing and replay unreliable. (b) A new
physical `session_events` table that everything writes to — rejected as a parallel
store (YAGNI / duplicates existing data). (c) Materialized view — rejected: refresh lag
breaks "resume reads the latest state."

**`session_id` derivation**: For a delegation, `session_id = delegation.id`; for a
Prime session, the existing `prime_agent_sessions.id`. Backfill existing rows via the
delegation/thread linkage in an idempotent migration.

## R2 — Resumable harness `wake(sessionId)` (FR-001, FR-002, FR-003, FR-016)

**Decision**: Add `wake(sessionId)` to the `AgentHarness` contract. `AcpHarness`
implements it by calling ACP `session/load` when the agent advertised the
`load_session` capability (already detected and persisted in `acp-harness.ts`
capability reconciliation), replaying nothing more than needed; when unavailable, it
falls back to re-dispatching from the latest `checkpoint_continuations` row for that
`owner_id`. Restart recovery (in `recovery/service.ts`, invoked from
`process-manager` boot) branches by `agents.tier`: `durable` → `wake` in place;
`ephemeral` → re-dispatch a fresh ephemeral from the continuation.

**Rationale**: The ACP SDK and `acp-harness` already negotiate `load_session`, so
native resume is a small addition, not new infrastructure. `checkpoint_continuations`
already supports `owner_type='delegation'` with `context_snapshot` + `continuation`,
giving a ready fallback. Tiering matches the clarified Q3 answer and keeps ephemerals
disposable.

**Alternatives considered**: (a) Always re-dispatch (ignore native reload) — simpler
but loses partial progress and wastes tokens. (b) Persist full in-memory harness state
— rejected: contradicts Principle VI (state must live in the durable log, not the
harness).

**Idempotency (FR-004)**: A recovery claim uses the same `FOR UPDATE SKIP LOCKED`
pattern as `prime_queue_items.claimNextItem`, plus a `recovery_epoch` on the delegation
so a duplicate wake is a no-op (already-resumed or already-completed short-circuits).
Side-effecting tool calls are gated by the existing approval/permission path, which is
re-evaluated on resume rather than replayed.

## R3 — Credential broker (FR-007–FR-011)

**Decision**: A `CredentialBroker` issues per-agent, short-lived credentials at
provisioning time and revokes them at teardown. Scopable upstreams (Gitea, named
secrets) get derived/scoped tokens; un-scopable upstreams (LLM provider keys) get a
broker-minted **proxy token** that authorizes calls to the control-plane LLM proxy
(R4) — never the raw key. Durable agents get a background rotation job (≤24h TTL);
credentials that cannot be auto-rotated or that exceed TTL emit a
`credential.risk_flagged` event. Backed by the existing encrypted secret store
(`crypto.ts` / `SECRET_ENCRYPTION_KEY`) and the existing `agent_tokens` mechanism for
the control-plane token.

**Rationale**: Reuses encryption + token primitives already in the codebase; layers
issuance/rotation/revocation on top per spec 010's inherited assumptions. Injecting
secrets only as process env at start (never files) satisfies FR-009 and SC-002.

**Alternatives considered**: (a) Keep current plaintext provider-key env injection —
rejected by clarify (subverted agent reads it). (b) External vault product (e.g.,
Vault) — rejected as YAGNI for single-tenant self-host; the encrypted DB store +
broker is sufficient.

## R4 — Control-plane LLM/egress proxy (FR-008, FR-019, FR-020)

**Decision**: A control-plane outbound proxy is the **only** egress path for agent
runtimes. Two cooperating pieces: `proxy/llm-proxy.ts` accepts a broker proxy token,
attaches the real provider key server-side, and forwards to the provider; `proxy/egress.ts`
enforces a per-agent default-deny allowlist for any other outbound host. Enforcement
uses the sandbox's network namespace (R5): no DNS inside, no direct outbound TCP, all
traffic via a unix-domain-socket/loopback proxy the agent cannot reconfigure away.

**Rationale**: Mirrors Anthropic's documented model (egress proxy + empty resolv.conf +
firewall blocking raw TCP) and the FR-008 clarification (control-plane proxy). Keeps
the provider key entirely server-side, so prompt injection cannot exfiltrate it.

**Alternatives considered**: (a) App-level allowlist inside the agent — rejected: a
subverted agent bypasses in-process checks. (b) Per-call signed URLs — rejected: does
not cover arbitrary egress, only the provider call.

**Allowlist source**: Derived from the agent's declared capabilities + assigned MCP
servers (`agent_mcp_assignments`), default-deny; new hosts require an explicit operator
allowlist decision surfaced through the existing approval queue.

## R5 — gVisor-class sandbox + scoped filesystem (FR-018, FR-021, FR-022)

**Decision**: Wrap each agent runtime process (`opencode serve` / `pi-acp` / ACP
subprocess spawned in `process-manager.ts`) in a gVisor-class userspace-kernel sandbox
(`runsc`) with: a read/write bind only to the agent's working directory; no mounts of
credential paths or other agents' worktrees; and the R4 network namespace (default-deny
egress). Container runs with gVisor as the security boundary per the semi-trusted
baseline; per-task microVM is explicitly out of scope (Q1).

**Rationale**: gVisor is the 2026 pragmatic middle ground — stronger than
container/namespace isolation, far lighter than microVMs — and matches the clarified
semi-trusted posture and the ≤5s readiness budget (runsc start is sub-second; the
agent runtime boot dominates).

**Alternatives considered**: (a) Namespaces/hardened container only (Option C) —
rejected by clarify as too weak against escape. (b) Firecracker microVM per task
(Option B) — rejected as over-engineered for single-tenant operator-own code; revisit
only if untrusted/third-party code execution is introduced (FR-022 trigger).

**Readiness budget validation**: runsc cold start ≈100–300 ms + agent runtime boot +
MCP handshake; target ≤5s p95 is comfortably achievable without a pre-warm pool,
confirming FR-014/SC-004 are feasible.

## R6 — On-demand (cattle) provisioning + idle reclaim (FR-012, FR-013, FR-014)

**Decision**: A `RuntimeLease` manager replaces eager boot. `OpenCodeProcessManager`
no longer spawns durable agents in `initialize()`; instead the dispatcher acquires a
lease when routing work to an agent, which provisions the sandboxed runtime on first
use and queues concurrent work against a still-provisioning agent. A reclaim sweep
(reusing `node-cron`) tears down runtimes idle for 10 minutes, preserving the agent's
DB identity/records. Behind a flag; legacy eager boot remains as rollback (FR-017).

**Rationale**: `agents.state` already models `provisioning/ready/busy/idle/retiring/
terminated`, so the lease maps onto existing lifecycle states and events. Cheap (≤5s)
re-provisioning makes prompt 10-min reclaim safe.

**Alternatives considered**: (a) Keep eager boot, only add idle reclaim — rejected:
still pays boot cost for never-used agents. (b) Pre-warmed pool — rejected by clarify
(adds idle cost/complexity; readiness budget is met without it).

## R7 — Observability & rollback (FR-015, FR-017, SC-006)

**Decision**: All new lifecycle moments emit `runtime_events` rows with typed
`event_type`s (`session.resumed`, `delegation.recovered`, `credential.issued|rotated|
revoked|risk_flagged`, `runtime.leased|reclaimed`, `egress.denied`, `fs.denied`). Each
phase ships behind a feature flag with the legacy path retained until validated.

**Rationale**: Single observable stream (already the audit surface) satisfies SRE
readiness and lets SC-006 (no regression) be measured by comparing delegation success
before/after with flags off/on.
