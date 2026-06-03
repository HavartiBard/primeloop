# Feature Specification: ACP Adapter Standardization

**Feature Branch**: `022-acp-adapter`

**Created**: 2026-06-02

**Status**: Draft

**Input**: User description: "Restructure the agent adapter layer to conform to the Agent Client Protocol (ACP, agentclientprotocol.com)."

## Overview

The control plane integrates with agent runtimes through a bespoke adapter contract. Each new
runtime requires hand-written integration code, and the richest existing adapter encodes the
agent conversation as a stream of stringly-typed, custom events. The Agent Client Protocol (ACP)
is an open, JSON-RPC-based standard for the boundary between a *client* (here, the control plane)
and an *agent* (the runtime doing the work). Adopting ACP at this boundary lets any
ACP-compliant agent connect with no bespoke integration, and replaces ad-hoc event strings with
a typed, well-understood vocabulary for streaming updates, permission requests, and cancellation.

This feature standardizes the agent⇄control-plane integration boundary on ACP for
**locally-spawned subprocess agents**. It does not change the orchestration layer (Prime routing,
fleet dispatch logic, work-item model, cost ledger, grading). ACP becomes the **native** adapter
contract; the existing bespoke adapters are placed on a deprecation path.

## Clarifications

### Session 2026-06-02

- Q: Adapter strategy — additive ACP adapter alongside existing, or reshape the contract to be ACP-native? → A: Reshape `AgentAdapter` to be ACP-native; existing `opencode`/`generic-http` adapters become deprecated shims with a plan to remove them. (Context: Prime is the only functional agent today, so the existing adapters carry no production load and the rewrite risk is low.)
- Q: How should agent permission requests be decided? → A: Configurable risk-classified policy — low-risk requests (e.g., in-sandbox file reads) auto-resolve; sensitive requests (e.g., out-of-sandbox or destructive actions) gate to the approval queue and block until an operator answers.
- Q: Should client-side `terminal/*` capabilities be exposed in v1? → A: No — defer terminal to a later iteration. Expose only file read/write in v1; the agent's own subprocess executes commands internally.
- Q: What happens when a sensitive permission request is left unanswered? → A: Configurable timeout that defaults to **deny** on expiry (fail-safe); the agent aborts the action. Timeout is configurable so interactive sessions can extend it.
- Q: When negotiated capabilities and the registry `capabilities[]` disagree, which is authoritative? → A: Negotiated capabilities are authoritative at runtime (runtime truth wins, per spec 015); the registry value is a hint/default for pre-dispatch routing and is reconciled/updated from the handshake.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect a standard ACP agent with no bespoke code (Priority: P1)

An operator registers a locally-runnable, ACP-compliant agent (e.g., a CLI agent that speaks ACP
over standard input/output) and dispatches work to it through the control plane. The agent runs
end-to-end — receiving the task, streaming progress back to the canvas, and completing — without
anyone writing a runtime-specific adapter.

**Why this priority**: This is the core value of the feature. If a standard agent cannot run
end-to-end through the existing dispatch path, nothing else matters. It is the minimum viable
slice that proves ACP is wired into the platform.

**Independent Test**: Register one real ACP agent (Gemini CLI is the reference target), dispatch
a task, and confirm the task starts, streams updates, and completes with a terminal status — all
through the existing fleet dispatch path, with no runtime-specific code added.

**Acceptance Scenarios**:

1. **Given** an ACP-compliant agent registered for local subprocess execution, **When** a task is
   dispatched to it, **Then** the control plane negotiates protocol version and capabilities,
   creates a session, sends the prompt, and the agent begins work.
2. **Given** a running ACP session, **When** the agent emits progress (text, tool activity, plan
   updates), **Then** those updates appear on the canvas with at least the same fidelity as
   today's stream.
3. **Given** a running ACP session, **When** the agent finishes, **Then** the control plane
   records a terminal task status (completed or failed) consistent with how existing adapters
   report completion.

---

### User Story 2 - Agent permission requests gate execution through the approval queue (Priority: P1)

While an ACP agent is working, it requests permission before performing an action. A configurable
risk-classification policy decides each request: low-risk requests (e.g., in-sandbox file reads)
auto-resolve so autonomous runs keep progressing, while sensitive requests (e.g., out-of-sandbox
or destructive actions) surface in the existing approval queue and block the agent until an
operator approves or denies.

**Why this priority**: Permission gating is a safety-critical control. Today's permission flow is
an ad-hoc event string; ACP makes it a first-class request/response. Without risk-based gating, a
standardized agent could either act without oversight or stall every autonomous run — both
unacceptable for the platform.

**Independent Test**: Trigger a low-risk action and confirm it auto-resolves without an approval
item; trigger a sensitive action, confirm an approval item appears in the queue, and verify that
approving lets the agent continue while denying stops the action.

**Acceptance Scenarios**:

1. **Given** an ACP agent requests permission for an action the policy classifies as low-risk,
   **When** the request arrives, **Then** it auto-resolves per policy without creating an approval
   item and the agent continues.
2. **Given** an ACP agent requests permission for an action the policy classifies as sensitive,
   **When** the request arrives, **Then** a corresponding item appears in the existing approval
   queue and the agent's turn is blocked.
3. **Given** a pending (sensitive) permission item, **When** an operator approves it, **Then** the
   agent receives the approval and continues the action.
4. **Given** a pending (sensitive) permission item, **When** an operator denies it, **Then** the
   agent receives the denial and does not perform the action.

---

### User Story 3 - Cancel an ACP agent mid-turn (Priority: P2)

An operator cancels a task while the ACP agent is actively working. The agent stops promptly and
the task settles into a cancelled/terminal state.

**Why this priority**: Cancellation is essential for operability and cost control, but it depends
on a working session (Stories 1 and 2) existing first.

**Independent Test**: Start a long-running task, cancel it mid-turn, and confirm the agent stops
and the task reaches a terminal state without orphaned processes.

**Acceptance Scenarios**:

1. **Given** an actively running ACP session, **When** the operator cancels the task, **Then** the
   control plane signals cancellation and the agent halts the current turn.
2. **Given** a cancelled ACP session, **When** the agent process exits, **Then** the control plane
   releases associated resources and records a terminal status.

---

### User Story 4 - Existing adapters deprecate gracefully without breaking current behavior (Priority: P2)

The ACP-native contract replaces the bespoke adapter contract. Any agent still relying on the
legacy `opencode`/`generic-http` paths continues to function through deprecated shims during the
transition, with a clear plan to remove those shims once no agent depends on them.

**Why this priority**: Prime is the only functional agent today and does not run through these
adapters, so no production agent traffic depends on them. The deprecation must therefore avoid
regressions during transition but does not need to preserve the legacy contract indefinitely. This
is lower priority than the core ACP path (Stories 1–2) precisely because the legacy paths carry no
live load.

**Independent Test**: Dispatch work to an agent that still uses a legacy path and confirm it
behaves as before via the deprecated shim; confirm the shim is clearly marked deprecated and that
removing it is a tracked follow-up.

**Acceptance Scenarios**:

1. **Given** an agent registered against a legacy adapter path, **When** work is dispatched,
   **Then** it runs through a deprecated shim with behavior equivalent to before the change.
2. **Given** the ACP-native contract is in place, **When** an agent is dispatched, **Then** the
   correct path (ACP-native or deprecated shim) is selected automatically based on the agent's
   registration.
3. **Given** the deprecation plan, **When** no agent depends on a legacy shim, **Then** that shim
   can be removed without affecting ACP agents or orchestration.

---

### Edge Cases

- **Version/capability mismatch**: The agent advertises an unsupported protocol version or lacks a
  required capability during negotiation. The control plane must fail the task with a clear,
  actionable reason rather than hanging or partially proceeding.
- **Agent process crash mid-turn**: The subprocess exits unexpectedly. The task must settle into a
  failed terminal state and resources must be released (no orphaned processes).
- **Agent requests a capability the client does not offer** (e.g., a file or terminal operation
  outside the permitted scope). The request must be denied safely and surfaced, not silently
  honored.
- **File/terminal access outside the agent's workspace**: An agent-initiated file or terminal
  request that targets a path outside its sandboxed workspace must be rejected.
- **Permission request left unanswered**: A sensitive permission request that is never approved or
  denied MUST resolve on a configurable timeout, defaulting to **deny** (fail-safe), after which the
  agent aborts the action; the cancellation path must also still settle it.
- **Malformed or unexpected protocol messages**: Non-conforming messages from the agent must be
  handled without crashing the control plane.

## Constitution Alignment *(mandatory)*

- **Code Quality Plan**: The shared adapter contract is reshaped to be ACP-native, but consumers
  (fleet dispatch, approval queue, canvas, broadcast) are insulated by keeping the same internal
  runtime-event and task-status surfaces they consume today. Behavior is verified with backend
  tests covering session lifecycle, permission gating, cancellation, and error/negotiation
  failures, plus at least one end-to-end run against a real ACP agent. Protocol message handling
  is validated against the published ACP message shapes.

- **YAGNI Check**: The adapter contract becomes ACP-native; legacy `opencode`/`generic-http`
  adapters are retained only as deprecated shims with a tracked removal plan. No new orchestration
  abstractions are introduced. Remote ACP transport, terminal capabilities, multi-tenant concerns,
  and runtimes beyond the reference agent are explicitly out of scope until the local path is proven.

- **Reliability & Operations**: Each session emits lifecycle signals (start, progress, completion,
  failure, cancellation) consistent with existing behavior. Negotiation failures, process crashes,
  and protocol errors produce actionable diagnostics. Cancellation and crash paths release the
  subprocess and associated resources. Legacy shims provide a transition path; their removal is
  gated on no agent depending on them.

- **UX Consistency**: Permission requests use the existing approval queue with its established
  pending/approved/denied states. Streaming updates render on the existing canvas with at least
  parity to the current stream. No new operator-facing surfaces are introduced; terminology
  follows existing dispatch, approval, and task-status language.

- **Design Consistency**: No new UI patterns. The feature reuses the approval queue, canvas event
  rendering, and task-status presentation already in the product.

- **ACP Architecture Constraints**: Prime routing and delegation are unchanged; this affects only
  the agent⇄control-plane boundary below dispatch. Durable records (tasks, approvals, delegations)
  continue to use existing stores and identifiers. Per-agent isolation is preserved: agent-initiated
  file access is confined to the agent's sandboxed workspace (terminal access is out of scope for
  v1). Single-tenant assumptions are unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST integrate ACP-compliant agents that run as locally-spawned
  subprocesses, communicating over the protocol's standard local transport.
- **FR-002**: The system MUST negotiate protocol version and capabilities with the agent before
  dispatching work, and MUST fail the task with an actionable reason if negotiation fails or
  required capabilities are absent.
- **FR-003**: The system MUST create an agent session and deliver the task prompt to it, and MUST
  support delivering additional messages to an existing session.
- **FR-004**: The system MUST translate the agent's streaming session updates (text, tool activity,
  plans, and diffs) into the platform's internal runtime-event representation so they appear on the
  canvas with at least parity to the current stream.
- **FR-005**: The system MUST evaluate each agent permission request against a configurable
  risk-classification policy. Requests classified as low-risk MUST auto-resolve per policy without
  creating an approval item; requests classified as sensitive MUST be routed into the existing
  approval queue, block the agent's turn until resolved, and relay the operator's approval or denial
  back to the agent. The policy MUST default to gating (treat-as-sensitive) for any request it
  cannot confidently classify as low-risk.
- **FR-006**: The system MUST support cancelling an in-progress agent turn, after which the agent
  halts and the task settles into a terminal state with resources released.
- **FR-006a**: A sensitive permission request that remains unanswered MUST resolve on a configurable
  timeout, defaulting to deny on expiry, after which the agent aborts the gated action.
- **FR-007**: The system MUST expose client-side file read and file write capabilities to the agent,
  confined to the agent's sandboxed workspace, and MUST reject requests targeting paths outside that
  workspace.
- **FR-008**: The system MUST make ACP the native adapter contract, and MUST select the appropriate
  path (ACP-native or a deprecated legacy shim) automatically based on an agent's registration,
  without operator intervention.
- **FR-009**: The system MUST keep legacy `opencode`/`generic-http` agents functional through
  deprecated shims during the transition, with behavior equivalent to before the change.
- **FR-010**: The system MUST clearly mark the legacy paths as deprecated and MUST allow a
  deprecated shim to be removed once no agent depends on it, without affecting ACP agents or
  orchestration.
- **FR-011**: The system MUST associate each agent session with the platform's existing task,
  delegation, and work-item identifiers so that streamed updates, approvals, and completion are
  correlated to the originating work.
- **FR-012**: The system MUST handle agent process crashes and malformed protocol messages without
  destabilizing the control plane, settling the affected task into a failed terminal state.
- **FR-013**: The system MUST treat capabilities discovered during negotiation as authoritative at
  runtime. The registry `capabilities[]` field serves as a pre-dispatch hint/default and MUST be
  reconciled (updated) from the negotiated handshake when they disagree. Work MUST NOT be dispatched
  to a capability the agent does not advertise at negotiation time.

### Key Entities *(include if feature involves data)*

- **Agent session**: A single conversation with a spawned agent, correlated to the platform's task,
  delegation, and work-item identifiers. Has a lifecycle (created → working → terminal).
- **Session update**: A streamed, typed unit of agent progress (text, tool activity, plan, diff)
  translated into the platform's internal runtime-event representation.
- **Permission request**: An agent-initiated request for authorization to perform an action,
  evaluated against the risk-classification policy. Sensitive requests become items in the existing
  approval queue with pending/approved/denied states; low-risk requests are auto-resolved per policy.
- **Permission policy**: Configurable rules that classify a permission request as low-risk
  (auto-resolve) or sensitive (gate to the approval queue), defaulting to gating when classification
  is uncertain.
- **Client capability grant**: A scoped capability the control plane offers an agent (file read,
  file write) bounded to the agent's sandboxed workspace.
- **Agent registration**: Existing registry record extended to indicate ACP local-subprocess
  execution, used for automatic path selection. Its `capabilities[]` is a pre-dispatch hint/default,
  reconciled from the negotiated handshake (negotiated capabilities are authoritative at runtime).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A real ACP-compliant agent (reference target: Gemini CLI) completes a dispatched task
  end-to-end through the existing dispatch path with no runtime-specific adapter code written for it.
- **SC-002**: Adding a second ACP-compliant agent requires only registration — zero new integration
  code — demonstrating the standardization benefit.
- **SC-003**: 100% of permission requests classified as sensitive surface in the approval queue and
  gate the agent's action; no sensitive action proceeds without an approval decision. Low-risk
  requests auto-resolve without operator interaction.
- **SC-004**: Streamed agent updates render on the canvas with at least the same fidelity as the
  current adapter (no regression in displayed progress).
- **SC-005**: A task cancelled mid-turn reaches a terminal state and leaves no orphaned agent
  process.
- **SC-006**: Agents on legacy paths pass their current behavioral checks via deprecated shims after
  the ACP-native contract is introduced, and the legacy paths are clearly marked deprecated with a
  tracked removal follow-up.
- **SC-007**: Operational failures (negotiation failure, process crash, malformed messages) produce
  diagnostics sufficient to identify the cause within 10 minutes.

## Assumptions

- **Adapter strategy is ACP-native with deprecation**: The shared adapter contract is reshaped to
  *be* ACP. The existing `opencode`/`generic-http` adapters become deprecated shims kept only to
  avoid regressions during transition, with a tracked plan to remove them. This is acceptable
  because Prime — the only functional agent today — does not run through these adapters, so they
  carry no production load.
- **Local transport only, for now**: ACP's remote (HTTP/WebSocket) transport is treated as immature
  and is out of scope. Only locally-spawned subprocess agents use the ACP path; remote-endpoint
  agents continue on their existing adapters until ACP remote transport stabilizes.
- **File capabilities in, terminal capabilities deferred**: Client-side file read/write are exposed
  to agents within the sandboxed workspace. Terminal capabilities are considered out of scope for
  the first iteration (the agent's own subprocess context handles command execution); they can be
  added later behind the same boundary if a target agent requires them.
- **Sandbox reuse**: Agent-initiated file access is confined to the agent's existing sandboxed
  workspace; no new sandboxing mechanism is introduced beyond the platform's current isolation
  model.
- **Reference agent**: Gemini CLI is the reference ACP implementation used to validate the
  end-to-end path; the design must not be specific to it.
- **Reused platform surfaces**: The approval queue, agent registry, canvas event rendering, and
  broadcast paths are reused as-is; no new orchestration abstractions are introduced.
- **Orchestration unchanged**: Prime routing, fleet dispatch logic, work-item model, cost ledger,
  and grading are unaffected and out of scope.
