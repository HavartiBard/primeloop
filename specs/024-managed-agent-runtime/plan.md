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
eager boot; (5) **contain** each runtime on two dimensions — scoped filesystem +
default-deny egress — under a semi-trusted (gVisor-class) baseline.

Technical approach: extend existing primitives rather than replace them. Add a
`session_id` + per-session `seq` to `runtime_events` and a read-model
`SessionStore` over events/messages/traces/checkpoints; add `wake(sessionId)` to the
harness contract backed by ACP `loadSession` (already negotiated) with
checkpoint re-dispatch fallback; add `CredentialBroker` + control-plane LLM proxy +
per-agent egress allowlist; add a `RuntimeLease` manager driving on-demand
provisioning in `OpenCodeProcessManager`; wrap agent runtimes in a gVisor-class
sandbox with the egress proxy as the only outbound path.

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
│   └── egress-allowlist.md
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
│   ├── opencode/process-manager.ts# EXTEND — lazy provisioning, sandbox wrap, broker wiring
│   ├── mcp/server.ts              # EXTEND — broker-issued token instead of long-lived
│   ├── runtime.ts                 # EXTEND — insertRuntimeEvent writes session_id+seq
│   └── db.ts                      # EXTEND — idempotent migrations (see data-model.md)
└── tests/                         # Vitest unit + DB-backed integration + isolation tests

web/
└── src/                           # MINOR — resumed/recovered status labels, risky-cred badge
```

**Structure Decision**: Web-application layout; nearly all work is in `backend/src`
under new cohesive modules (`session/`, `credentials/`, `proxy/`, `runtime/`) plus
targeted extensions to existing files. Web changes are limited to status labeling.

## Implementation Phasing

Ordered by spec priority, with US4's session substrate first because US1 depends on it.

- **Phase A — Session substrate (US4, P3-but-foundational)**: `session_id` + `seq` on
  `runtime_events`; `SessionStore` read model with positional `getEvents`. Unblocks US1.
- **Phase B — Resumable recovery (US1, P1)**: `wake(sessionId)` on the harness (ACP
  `loadSession` + checkpoint re-dispatch fallback); tiered restart recovery (durable
  resume / ephemeral re-dispatch); idempotency guard; feature flag vs legacy fail-requeue.
- **Phase C — Broker + containment (US2 + US5, P2, coupled)**: `CredentialBroker`;
  control-plane LLM proxy; per-agent egress allowlist; gVisor-class sandbox wrap +
  scoped FS; route `mcp/server.ts` + provider calls through brokered tokens/proxy.
- **Phase D — Cattle provisioning (US3, P3)**: `RuntimeLease`; lazy provisioning in
  `OpenCodeProcessManager`; 10-min idle reclaim; flag vs legacy eager boot.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New subsystem: control-plane LLM proxy | FR-008 + clarification: un-scopable provider keys must never reach the runtime | Injecting a short-lived key into the runtime env (rejected in clarify) still exposes the raw key to a subverted agent; provider keys cannot be per-agent scoped upstream |
| New dependency: gVisor-class sandbox + egress proxy | FR-018/019/022 + constitution v1.2.0 two-dimension isolation | Today's worktree+subprocess has no kernel isolation and no egress control; namespaces-only (Option C) was rejected as too weak against escape for the prompt-injection threat |
| New read-model `SessionStore` over existing stores | FR-005/006 require one replayable, sliceable timeline; resume (US1) needs it as substrate | Querying each store ad hoc per resume is the current fragile state; no single ordered record means resume can't reconstruct reliably |
