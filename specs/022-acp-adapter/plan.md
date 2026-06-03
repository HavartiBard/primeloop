# Implementation Plan: ACP Adapter Standardization

**Branch**: `022-acp-adapter` | **Date**: 2026-06-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/022-acp-adapter/spec.md`

## Summary

Adopt the Agent Client Protocol (ACP) as the **native** contract for the agent⇄control-plane
boundary, scoped to **locally-spawned subprocess agents**. The control plane acts as an ACP
*client*: it spawns an agent as a subprocess, speaks JSON-RPC 2.0 over stdio, negotiates
capabilities, runs prompt turns, streams `session/update` notifications back to the canvas, and
services agent callbacks (`session/request_permission`, `fs/read_text_file`, `fs/write_text_file`).

The natural seam is the existing **`AgentHarness`** abstraction (`fleet-executor/harness.ts`),
which is the local-subprocess dispatch path the `FleetDispatcher` already drives — not the HTTP
`AgentAdapter`. ACP is delivered as a new `AcpHarness implements AgentHarness` plus a small ACP
client/session layer. The HTTP `AgentAdapter` family (`opencode`, `generic-http`) becomes the
**deprecated shim** for remote agents, kept only for transition. Permission requests are gated by a
configurable risk-classification policy into the existing approval queue, with a fail-safe deny
timeout. Negotiated capabilities are authoritative at runtime; the registry `capabilities[]` is a
reconciled hint.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js (backend, ESM with `.js` import specifiers)

**Primary Dependencies**: `@zed-industries/agent-client-protocol` (official ACP TypeScript library —
JSON-RPC framing + typed message schemas), `pg` (Postgres), existing fleet-executor/process-manager,
approval queue, WS broadcast, registry. Node `child_process` for subprocess spawning (already used by
`PiHarness`/`OpenCodeProcessManager`).

**Storage**: PostgreSQL via existing modules (`registry.ts`, `runtime.ts`, approvals). New durable
state: ACP session ↔ delegation/work-item correlation and permission-policy config; persisted via
existing tables/`config` columns where possible plus one migration if a dedicated mapping is needed.

**Testing**: Vitest (backend). Unit tests for the ACP client (message framing, negotiation,
update→event mapping, permission gating, timeout), plus a DB-backed integration test through the
disposable test DB. One end-to-end run against a real ACP agent (Gemini CLI) as a manual/CI-gated
verification (quickstart).

**Target Platform**: Linux server (self-hosted, single-tenant control plane).

**Project Type**: Web application monorepo (`backend/` + `web/`). This feature is backend-only;
the canvas already renders the internal runtime-event stream, so no new frontend surface.

**Performance Goals**: Streaming updates reach the canvas with no perceptible added latency vs.
today's stream; subprocess spawn + `initialize` + `session/new` handshake completes well within
existing dispatch timeouts.

**Constraints**:
- Local stdio transport only; ACP remote (HTTP/WS) is out of scope (immature upstream).
- Terminal capabilities (`terminal/*`) out of scope for v1; expose `fs/*` only, sandboxed.
- Agent-initiated `fs/*` confined to the agent's sandboxed workspace (`worktree_path`/`workspace_root`).
- Consumers of `HarnessEvent` (FleetDispatcher, Prime runtime-truth) must keep working unchanged.
- Additive/reversible: ACP path selected by agent registration; legacy paths still resolve.

**Scale/Scope**: Single operator. One reference ACP agent at first (Gemini CLI); Prime is the only
agent functional today and does not use these adapters, so legacy paths carry no production load.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code quality**: ACP message handling is isolated in a dedicated client/session module with typed
  inputs (from the official ACP library), so the `AcpHarness` stays thin and the existing
  `HarnessEvent` surface consumed by the dispatcher is unchanged. Failure paths (negotiation
  failure, crash, malformed message, denied permission, timeout) are explicit. Verification is
  proportional: unit tests for the protocol/mapping/policy logic, integration test for the dispatch
  path, manual e2e against a real agent.

- **YAGNI**: One new dependency (official ACP library) — justified to avoid hand-rolling JSON-RPC
  framing and the full message schema (the very fragmentation/maintenance cost this feature removes).
  One new harness implementation. The permission policy is a small configurable classifier, not a
  rules engine. No remote ACP transport, no terminal support, no new orchestration abstractions —
  all explicitly deferred.

- **SRE readiness**: Each session emits lifecycle signals via existing `runtime_events` and the
  `HarnessEvent` stream (start, progress, tool activity, completion, failure, cancellation).
  Negotiation/version mismatch, subprocess crash, and malformed messages produce actionable
  diagnostics and settle the task into a failed terminal state with the subprocess reaped (no
  orphans). The permission timeout fails safe (deny). Rollback: registration selects the path, so
  reverting an agent to a legacy runtime_family restores prior behavior.

- **UX consistency**: Sensitive permission requests use the existing approval queue with its
  pending/approved/denied states and terminology. Streamed updates render on the existing canvas at
  parity. No new operator surface; classification thresholds use existing config patterns.

- **Visual polish**: No new UI components. Reuses approval queue and canvas event rendering.

- **ACP architecture constraints** (Agent Control Plane constitution): Prime remains the sole
  steering interface — this changes only the boundary below dispatch. Durable records (delegations,
  approvals, runtime_events) remain source of truth; ACP session IDs are correlated to, not a
  replacement for, delegation/work-item IDs. Per-agent isolation preserved: `fs/*` confined to the
  agent's sandboxed workspace. Single-tenant unchanged.

No constitutional violations. Complexity tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/022-acp-adapter/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (ACP method ↔ internal mappings)
│   ├── acp-client.md
│   ├── harness-contract.md
│   └── permission-policy.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/src/
├── acp/                              # NEW: ACP client layer (control plane = ACP client)
│   ├── client.ts                     # JSON-RPC/stdio session: initialize, session/new, prompt, cancel
│   ├── update-mapper.ts              # session/update → HarnessEvent translation
│   ├── permission.ts                 # risk classification + approval-queue bridge + deny timeout
│   ├── fs-handler.ts                 # fs/read_text_file + fs/write_text_file, sandbox-confined
│   └── types.ts                      # local types / re-exports from the ACP library
├── fleet-executor/
│   ├── acp-harness.ts                # NEW: AcpHarness implements AgentHarness (spawn + ACP client)
│   ├── harness.ts                    # AgentHarness contract (unchanged surface; ACP-native semantics documented)
│   ├── pi-harness.ts                 # EXISTING (legacy local harness; unaffected)
│   └── dispatcher.ts                 # EXISTING consumer (unchanged)
├── opencode/
│   └── process-manager.ts           # MODIFY: select AcpHarness for ACP-registered agents
├── adapters/                         # DEPRECATED shims (remote HTTP path), marked deprecated
│   ├── index.ts                      # MODIFY: mark legacy, route ACP runtime_family away from HTTP
│   ├── opencode.ts                   # DEPRECATED shim (unchanged behavior)
│   └── generic-http.ts              # DEPRECATED shim (unchanged behavior)
├── registry.ts                       # MODIFY: reconcile capabilities[] from negotiated handshake
└── migrations/                       # MODIFY: optional migration for session mapping / policy config

backend/tests/
├── acp/                              # NEW: unit tests (client, mapper, permission, fs sandbox)
└── fleet-executor/                   # NEW: AcpHarness + dispatch integration test
```

**Structure Decision**: Web-application monorepo, backend-only change. ACP protocol concerns live in
a new `backend/src/acp/` module; the dispatch integration is a new `AcpHarness` under the existing
`fleet-executor/`, selected by the existing `OpenCodeProcessManager`. The HTTP `adapters/` directory
is retained as deprecated shims. No frontend changes — the canvas already consumes `HarnessEvent`.

## Complexity Tracking

No constitutional violations to justify.
