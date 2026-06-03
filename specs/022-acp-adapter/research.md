# Phase 0 Research: ACP Adapter Standardization

All spec-level NEEDS CLARIFICATION were resolved in `/speckit-clarify` (see spec Clarifications).
This document records the technical decisions needed to design the implementation.

## D1 — Where ACP attaches: harness layer, not the HTTP adapter

**Decision**: Implement ACP as a new `AcpHarness implements AgentHarness`
(`fleet-executor/acp-harness.ts`), spawned/managed by `OpenCodeProcessManager`. The HTTP
`AgentAdapter` family (`adapters/opencode.ts`, `adapters/generic-http.ts`) becomes the deprecated
remote shim.

**Rationale**: The control plane has two integration seams:
- `AgentHarness` (`start`/`dispatch`/`abort`/`close`, `HarnessEvent` stream) is the **local
  subprocess** path. It is what `FleetDispatcher` (`getHarness(agentId)`) and Prime runtime-truth
  actually consume, and it is already implemented as a spawned process (`PiHarness` via
  `OpenCodeProcessManager`). ACP-over-stdio is, by definition, a spawned local subprocess speaking
  a request/stream/cancel protocol — a near-exact fit for this interface.
- `AgentAdapter` (`discover`/`startTask` over HTTP/SSE) is the **remote endpoint** path, used by
  `routes/agents.ts` and `delegation-runner.ts`. ACP's remote transport is immature upstream and out
  of scope, so this layer becomes the legacy shim.

The spec's "reshape the contract to be ACP-native" is realized at the harness layer: `AgentHarness`
becomes the native local contract whose lifecycle is implemented over ACP. The `HarnessEvent` union
is the stable internal surface; consumers do not change.

**Alternatives considered**:
- *Reshape the HTTP `AgentAdapter` interface itself to be ACP-native.* Rejected: that layer is the
  remote path; forcing stdio semantics into an HTTP-shaped interface inverts the abstraction and
  would still require a harness for subprocess lifecycle.
- *Merge `AgentHarness` and `AgentAdapter` into one interface now.* Rejected (YAGNI): no current need;
  the two seams serve local vs remote. Unification can follow once remote ACP exists.

## D2 — ACP protocol library vs hand-rolled JSON-RPC

**Decision**: Depend on the official ACP TypeScript library (`@zed-industries/agent-client-protocol`)
for JSON-RPC 2.0 framing over stdio and the typed message schemas (initialize, session/new,
session/prompt, session/update variants, request_permission, fs/*).

**Rationale**: Hand-rolling JSON-RPC framing and re-deriving the full ACP schema is exactly the
bespoke maintenance burden this feature exists to remove (cf. the ~300-line SSE parser in
`adapters/opencode.ts`). The library tracks the spec and provides types, reducing drift. This is the
single justified new dependency per the YAGNI gate.

**Alternatives considered**:
- *Hand-roll over `child_process` + a minimal JSON-RPC codec.* Rejected: re-creates the
  stringly-typed fragility we are eliminating; higher long-term cost.
- *Reuse an MCP JSON-RPC client.* Rejected: ACP reuses some MCP content shapes but is a distinct
  method set; an MCP client would not cover session/permission/fs methods.

## D3 — Mapping `session/update` → `HarnessEvent`

**Decision**: A pure `update-mapper.ts` translates ACP `SessionUpdate` variants into the existing
`HarnessEvent` union:

| ACP `session/update` variant | `HarnessEvent` |
|---|---|
| `agent_message_chunk` (text content) | `{ type: 'message_update', delta }` |
| `tool_call` | `{ type: 'tool_call_start', tool, args }` |
| `tool_call_update` / `tool_call_result` | `{ type: 'tool_call_end', tool, result, error }` |
| `plan` | `{ type: 'progress', summary }` (rendered plan summary) |
| `current_mode_update` / `available_commands_update` | ignored in v1 (no consumer) |
| prompt-turn end (`stopReason`) | `{ type: 'task_end', result }` |

**Rationale**: Keeps every existing `HarnessEvent` consumer (dispatcher thread streaming, canvas,
broadcast) unchanged → SC-004 parity with no frontend work. Mapping is pure and unit-testable.

**Alternatives considered**: Extending `HarnessEvent` with ACP-specific variants. Deferred — no
current consumer needs richer types; revisit when the canvas wants native diff/plan rendering.

## D4 — Permission gating: risk classification + approval queue + deny timeout

**Decision**: On `session/request_permission`, `permission.ts` classifies the `toolCall` via a
configurable policy:
- **low-risk** (e.g., in-sandbox reads): auto-respond `selected` with an `allow_once` option, no
  approval item created.
- **sensitive** (writes outside workspace, network, destructive, or anything not confidently
  low-risk → **default gate**): create an approval-queue item, block the turn, and respond with the
  ACP option matching the operator decision (`allow_once`/`reject_once`). On no response within a
  configurable timeout, respond `reject_once` (fail-safe deny). On task cancellation, respond
  `cancelled`.

**Rationale**: Directly implements spec FR-005/FR-006a and SC-003. ACP already supplies typed
`options` with `optionId`/`kind`, so the bridge maps an operator approve/deny to the correct
`optionId`. Default-gate-on-uncertainty satisfies the safety requirement; configurable timeout bounds
cost/resource exposure of stalled autonomous runs.

**Alternatives considered**: Always-gate (rejected — stalls autonomous Prime-driven runs);
always-allow-in-sandbox (rejected — removes oversight of sensitive in-sandbox actions like
destructive file writes).

## D5 — Capability authority and registry reconciliation

**Decision**: Negotiated `agentCapabilities` from `initialize` are authoritative at runtime. After a
successful handshake, reconcile (update) the agent's registry `capabilities[]` from the negotiated
result; pre-dispatch routing continues to read `capabilities[]` as a hint. Refuse to drive a
capability the agent did not advertise.

**Rationale**: Implements FR-013 and aligns with spec 015 (routing runtime truth). The registry stays
a fast routing hint without being a stale source of truth.

**Alternatives considered**: Registry-authoritative (rejected — re-introduces drift spec 015 fixed).

## D6 — Sandboxed `fs/*` handler

**Decision**: `fs-handler.ts` services `fs/read_text_file` and `fs/write_text_file`, resolving every
`path` against the agent's sandbox root (`worktree_path` / `workspace_root` from the registry) and
rejecting any resolved path that escapes it (symlink-aware, absolute-path required by ACP). `terminal/*`
is **not** advertised in `clientCapabilities`; agents that attempt it are handled by the
"capability not offered" path.

**Rationale**: Implements FR-007 and the per-agent isolation constitution constraint using the
existing workspace/worktree model — no new sandbox mechanism (D-reuse). Mirrors the existing scope
gate in `dispatcher.ts` (`checkScope`).

**Alternatives considered**: Exposing terminal in v1 (rejected per clarification — no current
consumer, adds lifecycle/orphan surface).

## D7 — Session ↔ work correlation and lifecycle

**Decision**: The `AcpHarness` holds the ACP `sessionId` and binds it to the `delegation_id` /
`work_item_id` already flowing through `dispatch(prompt)` (prompt `metadata`). Lifecycle: `start()`
spawns the subprocess and performs `initialize`; `dispatch()` performs `session/new` (with sandbox
`cwd`) on first call then `session/prompt`, streaming until `stopReason`; `abort()` sends
`session/cancel`; `close()` terminates the subprocess and reaps it. Crashes/malformed messages settle
the task as failed and reap the process.

**Rationale**: Reuses existing identifiers (durable-records constitution constraint); keeps the
`AgentHarness` contract intact for the dispatcher.

**Alternatives considered**: A new sessions table as source of truth (rejected/YAGNI — correlation via
existing delegation/work-item IDs and `runtime_events` suffices for single-tenant v1).

## D8 — Agent registration / path selection

**Decision**: Add an ACP runtime family (e.g., `runtime_family = 'acp'`) plus the launch command in
the agent `config`. `OpenCodeProcessManager` selects `AcpHarness` for ACP-registered agents and
`PiHarness` otherwise; `adapters/index.ts` routes ACP families away from the HTTP shims and the HTTP
adapters are annotated `@deprecated` with a tracked removal follow-up.

**Rationale**: Implements FR-008/009/010 with automatic, registration-driven selection and a clean
rollback (change the family back). Reference agent Gemini CLI registers as an ACP local subprocess.

**Alternatives considered**: A global feature flag (rejected — per-agent registration is finer-grained
and matches how runtimes are already distinguished).
