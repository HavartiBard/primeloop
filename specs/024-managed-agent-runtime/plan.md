# Implementation Plan: Managed-Agent Runtime Alignment

**Branch**: `024-managed-agent-runtime` | **Date**: 2026-06-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/024-managed-agent-runtime/spec.md`

## Summary

Bring PrimeLoop's agent runtime in line with the managed-agents model on five
fronts: (1) make the durable event log a **resumable** record so backend/runtime
restarts resume in-flight delegations (durable resume in place, ephemeral
re-dispatch) instead of failing them; (2) expose a **unified, positionally
addressable session interface** over the currently fragmented stores; (3) add a
**credential broker** that issues short-lived scoped secrets and fronts un-scopable
provider keys behind a control-plane proxy so secrets never touch the workdir;
(4) provision durable staff **on demand** (cattle) with idle reclamation instead of
eager boot; (5) **contain** agents in a separate runtime container (built from one
configurable image, secrets kept in the primary container) with per-process isolation
inside — scoped filesystem + default-deny egress — under a semi-trusted baseline.

Technical approach: extend existing primitives rather than replace them. Add a
`session_id` + per-session `seq` to `runtime_events` and a read-model
`SessionStore` over events/messages/traces/checkpoints; add `wake(sessionId)` to the
harness contract backed by ACP `loadSession` (already negotiated) with
checkpoint re-dispatch fallback; add `CredentialBroker` + control-plane LLM proxy +
per-agent egress allowlist (the proxy is the **sole** holder of raw provider keys,
used by Prime and subagents alike); move agent runtimes into a **separate runtime
container** built from one configurable image (operator-selected runtimes; a setup
script generates the compose), reached via a launcher, with **per-process** isolation
(distinct UID + Landlock + default-deny egress + scoped token) inside it; add a
`RuntimeLease` manager (a process slot in the runtime container) driving on-demand
provisioning. Prime stays in the primary container, confined by its enumerated action
set rather than an OS sandbox.

## Technical Context

**Language/Version**: TypeScript (ES2022, `module: Node16`), Node.js 22

**Primary Dependencies**: Express, `pg` (PostgreSQL), `ws`, `@agentclientprotocol/sdk` + `pi-acp` (ACP), `@anthropic-ai/sdk`, `openai`, `node-cron`; web is React + Vite

**Storage**: PostgreSQL (single relational store of record; existing tables `runtime_events`, `prime_queue_items`, `checkpoint_continuations`, `delegations`, `agents`, `agent_tokens`, `providers`, `mcp_servers`, `agent_mcp_assignments`)

**Testing**: Vitest (`npm test`; DB-backed via `TEST_DATABASE_URL`, disposable Postgres in `docker-compose.test.yml`)

**Target Platform**: Self-hosted Linux server (single operator), Docker Compose deploy

**Project Type**: Web application — `backend/` (Node control plane + agent runtimes) and `web/` (React dashboard). The bulk of this feature is backend/runtime.

**Performance Goals**: On-demand provisioning ready ≤5s p95 / ≤10s p99 (no pre-warm pool); restart resume ≥99% of in-flight delegations without operator action.

**Constraints**: Secrets never written to workdir/config; default-deny egress through an unbypassable proxy; durable credential rotation ≤24h TTL; idle durable runtime reclaimed after 10 min; recovery idempotent; semi-trusted isolation baseline (gVisor-class, no per-task microVM).

**Scale/Scope**: Single tenant; a handful-to-dozens of durable + ephemeral agents; sessions up to thousands of events (positional slicing required to avoid full-history loads).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code quality**: New behavior lands behind existing seams (`AgentHarness`,
  `CheckpointStore`, `OpenCodeProcessManager`, `mcp/server.ts`). Each new unit
  (`SessionStore`, `wake()`, `CredentialBroker`, LLM proxy, `RuntimeLease`, sandbox
  wrapper) is cohesive and independently tested with explicit failure paths. **PASS**
- **YAGNI**: Every new subsystem maps to an accepted FR and a constitution v1.2.0
  constraint — none speculative. Reuses `runtime_events`, `checkpoint_continuations`,
  `agent_tokens`, `crypto.ts`/`SECRET_ENCRYPTION_KEY`, and the ACP `loadSession`
  capability already negotiated in `acp-harness.ts`. Out-of-scope items (multi-tenant,
  multi-host scheduling, pluggable session backends) explicitly excluded. **PASS**
- **SRE readiness**: FR-015 mandates observable events for resume, recovery outcome,
  credential issue/rotate/revoke, risky-credential flag, provisioning transition, and
  denied isolation attempts — all on `runtime_events`. FR-017 keeps the prior
  fail-and-requeue + eager-boot behaviors behind a flag as rollback. **PASS**
- **UX consistency**: No new primary workflow. Resumed/recovered states reuse existing
  agent/delegation status terminology and the existing event/timeline surfaces. **PASS**
- **Visual polish**: Surfaces (timeline, agent status, approval queue) already exist;
  changes are status labels (`resumed`/`recovered`) and a risky-credential indicator
  within current components. **PASS**
- **Primeloop architecture constraints**: Durable records stay the source of truth and
  become the *resumable* source of truth; Prime stays the sole steering interface;
  per-agent isolation is strengthened; single-tenant unchanged. **PASS**
- **Decoupled, replaceable runtime** (VI): `wake(sessionId)` makes runtimes
  kill-and-recreate safe with recovery from the durable log; brokered short-lived
  secrets never hit the workdir. **PASS**
- **Runtime containment**: Two-dimension isolation (scoped FS + default-deny egress
  proxy) with blast-radius containment under assumed compromise; gVisor-class strength
  proportionate to the semi-trusted level. **PASS**
- **Complexity tracking**: Two genuinely new subsystems (control-plane LLM proxy;
  gVisor-class sandbox + egress proxy) are recorded below — required by constitution
  v1.2.0, not speculative.

## Project Structure

### Documentation (this feature)

```text
specs/024-managed-agent-runtime/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (internal interface contracts)
│   ├── session-store.md
│   ├── harness-wake.md
│   ├── credential-broker.md
│   ├── llm-proxy.md
│   ├── runtime-lease.md
│   ├── egress-allowlist.md
│   └── launcher.md          # ACP-over-TCP transport bridge + runtime-container process mgmt
├── checklists/
│   └── requirements.md  # Spec quality checklist (done)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── session/                  # NEW — unified session read model + positional getEvents
│   │   ├── store.ts              # SessionStore: getSession/getEvents(range)/appendEvent
│   │   └── types.ts
│   ├── checkpoint-store.ts        # EXTEND — recovery/wake support for delegations
│   ├── checkpoint.ts              # EXTEND — CheckpointStore interface
│   ├── recovery/                  # EXTEND — restart recovery: resume vs re-dispatch by tier
│   │   └── service.ts
│   ├── fleet-executor/
│   │   ├── harness.ts             # EXTEND — add wake(sessionId) to AgentHarness
│   │   └── acp-harness.ts         # EXTEND — implement wake via ACP loadSession + fallback
│   ├── credentials/               # NEW — credential broker
│   │   ├── broker.ts              # issue/rotate/revoke, risky-flag
│   │   └── types.ts
│   ├── proxy/                     # NEW — control-plane outbound proxy
│   │   ├── llm-proxy.ts           # provider calls with key held server-side
│   │   └── egress.ts              # default-deny allowlist enforcement
│   ├── runtime/                   # NEW — on-demand provisioning
│   │   └── lease.ts               # RuntimeLease acquire/release + idle reclaim
│   ├── opencode/process-manager.ts# EXTEND — lease via launcher (no child spawn), broker wiring
│   ├── prime-agent/llm-router.ts  # EXTEND — Prime calls LLM via proxy (no raw key)
│   ├── mcp/server.ts              # EXTEND — broker-issued token instead of long-lived
│   ├── runtime.ts                 # EXTEND — insertRuntimeEvent writes session_id+seq
│   └── db.ts                      # EXTEND — idempotent migrations (see data-model.md)
└── tests/                         # Vitest unit + DB-backed integration + isolation tests

runtime-image/                     # NEW — single configurable agent-runtime image
├── Dockerfile                     # selected runtimes (opencode/pi/…) + per-process sandbox tooling
└── launcher/                      # ACP/HTTP launcher: starts UID-isolated agent processes

scripts/
└── setup.sh                       # NEW — generate docker-compose (primary + runtime container)

web/
└── src/                           # MINOR — resumed/recovered labels, risky-cred badge, session timeline
```

**Structure Decision**: Web-application layout. Most work is in `backend/src` under new
cohesive modules (`session/`, `credentials/`, `proxy/`, `runtime/`) plus targeted
extensions. New deployment infra: a separate `runtime-image/` (single configurable
image + launcher) and a `scripts/setup.sh` compose generator. Web changes are status
labels plus the session-timeline view.

## Implementation Phasing

Ordered by spec priority, with US4's session substrate first because US1 depends on it.

- **Phase A — Session substrate (US4, P3-but-foundational)**: `session_id` + `seq` on
  `runtime_events`; `SessionStore` read model with positional `getEvents`. Unblocks US1.
- **Phase B — Resumable recovery (US1, P1)**: `wake(sessionId)` on the harness (ACP
  `loadSession` + checkpoint re-dispatch fallback); tiered restart recovery (durable
  resume / ephemeral re-dispatch); idempotency guard; feature flag vs legacy fail-requeue.
- **Phase C — Broker + containment (US2 + US5, P2, coupled)**: `CredentialBroker`;
  control-plane LLM proxy as sole key holder (Prime + subagents route through it);
  separate runtime container (single configurable image) + launcher + setup script;
  per-process isolation inside (UID + Landlock + default-deny egress + scoped token);
  route `mcp/server.ts` + Prime `llm-router` through brokered tokens/proxy.
- **Phase D — Cattle provisioning (US3, P3)**: `RuntimeLease` as a process slot in the
  runtime container; lazy provisioning via the launcher; 10-min idle reclaim of agent
  processes (stop the runtime container when empty); flag vs legacy eager boot.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New subsystem: control-plane LLM proxy | FR-008 + clarification: un-scopable provider keys must never reach the runtime | Injecting a short-lived key into the runtime env (rejected in clarify) still exposes the raw key to a subverted agent; provider keys cannot be per-agent scoped upstream |
| New infra: separate runtime container (single configurable image) + launcher + setup script | FR-018/019/022/023/024/025 + constitution v1.2.0 two-dimension isolation; secret boundary must be a hard container wall | Co-residing agents with the control plane leaves keys reachable on sandbox escape; per-agent containers are O(agents) overhead. Per-process isolation (UID+Landlock+egress) inside one separate runtime container is proportionate to the semi-trusted/prompt-injection threat; gVisor at the container level stays optional |
| New read-model `SessionStore` over existing stores | FR-005/006 require one replayable, sliceable timeline; resume (US1) needs it as substrate | Querying each store ad hoc per resume is the current fragile state; no single ordered record means resume can't reconstruct reliably |
