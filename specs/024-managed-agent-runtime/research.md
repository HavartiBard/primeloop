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

## R5 — Runtime topology: separate runtime container + per-process isolation (FR-018, FR-021, FR-022, FR-023, FR-025)

**Decision**: Agent runtimes run in a runtime container **separate** from the primary
control-plane container, built from one configurable image (`primeloop-runtime`) whose
included runtimes the operator selects at provision (R8). The backend no longer spawns
agents as child processes; it asks a **launcher** in the runtime container (an ACP/HTTP
endpoint on the private compose network) to start an agent, and the harness connects to
it. Inside the runtime container each agent is isolated **per-process**: a distinct
UID, a scoped filesystem via Landlock (kernel ≥6.7 on the Unraid 6.12 host) and/or a
mount namespace bound to its working directory, per-UID default-deny egress
(`iptables`/`nftables` owner-match) whose only route is the R4 proxy, `no_new_privs` +
seccomp, and the per-agent scoped token injected by the launcher. A gVisor-class
(`runsc`) sandbox at the **runtime-container** level is optional and applied
proportionate to a runtime's trust.

**Rationale**: The credential boundary becomes a hard *container* wall (agents cannot
reach the primary container's keys/memory/filesystem), enforced by the runtime rather
than by per-process tricks. Per-process UID+Landlock+egress contains agent↔agent within
the runtime container. This matches the prompt-injection (not kernel-0-day) threat of
the semi-trusted posture; one shared runtime container (built per selected runtimes) is
far simpler operationally than per-agent containers and avoids nesting gVisor inside the
backend container.

**Alternatives considered**: (a) Per-agent containers — rejected as O(agents) overhead;
(b) per-runtime-family images — folded into the single configurable image (operator
selection at provision); (c) agents co-resident in the primary container — rejected
because a sandbox escape would reach the keys/control plane; (d) nesting gVisor inside
the backend container — rejected (needs privileged backend). Per-task microVM remains
out of scope unless untrusted/third-party code is introduced (FR-022 trigger).

**Readiness budget validation**: spawning a process in a warm runtime container is fast
(no per-agent container cold start), so ≤5s p95 (FR-014/SC-004) is comfortable; the
only cold path is the first agent of a not-yet-running runtime container (bounded
container start), documented as an exception.

## R6 — On-demand (cattle) provisioning + idle reclaim (FR-012, FR-013, FR-014)

**Decision**: A `RuntimeLease` manager replaces eager boot. `OpenCodeProcessManager`
no longer spawns durable agents in `initialize()`; instead the dispatcher acquires a
lease when routing work to an agent. A lease is a **process slot in the runtime
container** (R5): acquiring it asks the launcher to start the agent process (and starts
the runtime container itself if it is not yet running), queuing concurrent work against
a still-provisioning agent. A reclaim sweep (`node-cron`) kills agent processes idle for
10 minutes (zero idle *agent* compute, SC-004) and may stop the runtime container when
it holds no agents; the agent's DB identity/records are preserved. Behind a flag; legacy
eager boot remains as rollback (FR-017).

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

## R8 — Control-plane secret boundary, Prime confinement, and setup script (FR-023, FR-024, FR-026, FR-027)

**Decision**: The provider key lives in exactly one place — the control-plane proxy
(R4) in the primary container. Every brain and hand calls through it: subagents via
their injected scoped token, and **Prime** via the same proxy (Prime's `llm-router`
stops reading the raw provider key directly). Prime stays an in-process control-plane
service confined by its enumerated action set (`delegate`/`update_work_item`/
`request_approval`/`update_profile`/`no_op`) with risky actions gated by the approval
queue; it has no raw shell/filesystem/network tool, so it needs no OS sandbox. A
**setup script** generates the docker-compose for the primary + runtime container,
parameterized by the operator-selected runtimes, wiring the private network and
default-deny egress to the proxy.

**Rationale**: Concentrating raw keys in the proxy gives one invariant to audit
(SC-008) and bounds blast radius even if Prime is prompt-injected. Capability
confinement, not namespaces, is the right boundary for an orchestrator whose risk is
logical rather than syscall-level. The setup script is the missing provisioning piece
(no compose-builder exists yet) and is where runtime selection is materialized.

**Alternatives considered**: (a) Sandbox Prime in its own runtime — rejected: doesn't
reduce Prime's logical authority and adds complexity; revisit only if Prime gains raw
tool execution (FR-027 trigger). (b) Let Prime keep a raw key — rejected: violates the
single-key-holder invariant (SC-008).
