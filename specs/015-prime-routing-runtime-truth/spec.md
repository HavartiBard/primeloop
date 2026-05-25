# Feature Specification: Prime Routing + Runtime Truth

**Feature Branch**: `015-prime-routing-runtime-truth`

**Created**: 2026-05-23

**Status**: Draft

**Input**: "Prime should route work through executable runtime-aware dispatch instead of free-form delegation against enabled registry rows"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Prime delegates only to executable targets (Priority: P1)

When Prime decides that work should be delegated, the system should route that work only to agents or templates that are actually executable in the current runtime, rather than assuming any enabled registry row can accept work.

**Why this priority**: This closes the current false-positive delegation loop where Prime records a delegation but no worker can ever pick it up.

**Independent Test**: Can be fully tested by creating a fleet with enabled but non-runnable agents plus at least one runnable target, then verifying that delegation is routed only to runnable targets and never to non-dispatchable rows.

**Acceptance Scenarios**:

1. **Given** an agent row is `enabled=true` but has no runnable harness or spawn path, **When** Prime requests delegation, **Then** the system MUST NOT create a queued delegation targeting that agent
2. **Given** at least one dispatchable target exists for the requested work class, **When** Prime requests delegation, **Then** the router creates a concrete executable route and the work is eligible for pickup immediately
3. **Given** no dispatchable target exists, **When** Prime requests delegation, **Then** the system records the blocker as a routing outcome instead of pretending delegation succeeded

---

### User Story 2 - Prime plans against runtime truth, not raw registry inventory (Priority: P1)

When Prime reasons about the fleet, it should see which agents are merely registered, which are dispatchable now, which can be spawned, and which capabilities are currently missing.

**Why this priority**: The current context model makes Prime think "assembled 4 agents" means "4 viable workers," which is operationally false.

**Independent Test**: Can be fully tested by assembling Prime context for a mixed fleet and verifying that the returned context distinguishes registered agents, dispatchable agents, spawnable templates, and missing capabilities.

**Acceptance Scenarios**:

1. **Given** a durable staff row exists in the database but its runtime is unavailable, **When** Prime context is assembled, **Then** that row appears as registered but not dispatchable
2. **Given** a capability can be fulfilled only by spawning an ephemeral template, **When** Prime context is assembled, **Then** the capability appears as spawnable rather than currently dispatchable
3. **Given** no route exists for a requested work class, **When** Prime context is assembled, **Then** Prime sees that gap explicitly rather than inferring availability from enabled rows

---

### User Story 3 - Blockers become explicit routing outcomes with suggested remediations (Priority: P2)

When no executable route exists, the system should return a structured blocked outcome that explains why work cannot proceed and what fixes are available, instead of requiring bespoke error handling for each scenario.

**Why this priority**: This creates a generic self-healing path and reduces the need for scenario-specific patches in Prime action handling.

**Independent Test**: Can be tested by requesting work that has no valid route and verifying that the system emits a structured blocked outcome with a blocker type, explanation, and suggested fixes.

**Acceptance Scenarios**:

1. **Given** no agent or template can satisfy the requested work class, **When** routing is attempted, **Then** the result is `blocked_missing_capability` with at least one suggested remediation
2. **Given** an agent has the right role but its runtime is unhealthy, **When** routing is attempted, **Then** the result is `blocked_runtime_unavailable` with suggested fixes tied to runtime recovery
3. **Given** a blocked routing outcome is surfaced to the user, **When** Prime replies in-room, **Then** the response includes the blocker summary and concrete next-step options

---

### User Story 4 - Investigations route to a real execution path (Priority: P2)

When Prime encounters a hard failure or unresolved blocker, investigation work should route through the same executable routing layer so escalation does not stall on non-runnable durable staff.

**Why this priority**: The current self-healing loop delegates investigations to SRE even when no runnable SRE runtime exists, creating a second-order dead queue.

**Independent Test**: Can be tested by forcing a hard failure and verifying that the resulting investigation is either assigned to a runnable target, routed to a spawnable template, or returned as a structured blocked outcome with a user-visible recommendation.

**Acceptance Scenarios**:

1. **Given** a hard Prime failure occurs and a runnable SRE target exists, **When** the investigation is opened, **Then** the investigation routes to that target through the normal routing layer
2. **Given** no runnable SRE target exists but an SRE-capable template can be spawned, **When** the investigation is opened, **Then** the system chooses the spawn route instead of creating a dead queued delegation
3. **Given** no executable investigation route exists, **When** escalation is attempted, **Then** the user sees a blocked investigation outcome with suggested fixes instead of a misleading "investigation active" message

---

### User Story 5 - Prime expresses intent while the router owns placement (Priority: P3)

When Prime decides what should happen next, it should express work intent and constraints rather than inventing raw capability strings or directly selecting a target row.

**Why this priority**: This creates a cleaner contract between LLM reasoning and executable system behavior, and makes routing policy evolvable without prompt fragility.

**Independent Test**: Can be tested by verifying that Prime decisions request an intent-level action and the router deterministically resolves that request into a dispatch, spawn, investigation, or blocked result.

**Acceptance Scenarios**:

1. **Given** Prime wants diagnostic analysis of a stuck queue, **When** it emits a routing request, **Then** the request identifies the work class and constraints without naming an imaginary capability
2. **Given** router policy changes for how a work class is fulfilled, **When** Prime emits the same request, **Then** the backend route can change without changing the agent-facing task contract

### Edge Cases

- What happens when multiple dispatchable targets exist with overlapping capabilities but different health or load?
- What happens when a target is dispatchable at plan time but becomes unavailable before claim time?
- How are duplicate routing attempts deduplicated when repeated Prime turns encounter the same blocked work?
- How does the system distinguish a transient runtime outage from a persistent missing-capability gap?
- What happens when the best route requires operator approval before tool grants or credentials can be leased?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST distinguish between `registered`, `dispatchable`, and `spawnable` execution capacity when assembling Prime context
- **FR-002**: System MUST resolve Prime work requests through a routing layer that validates executable runtime availability before creating a concrete delegation
- **FR-003**: System MUST prevent creation of queued delegations for targets that have no runnable harness and no supported spawn path
- **FR-004**: System MUST support explicit routing outcomes including `dispatch_existing`, `spawn_ephemeral`, `blocked_missing_capability`, `blocked_runtime_unavailable`, `investigate`, and `request_user_decision`
- **FR-005**: System MUST surface routing outcomes back to Prime in structured form so the room response can reflect what actually happened
- **FR-006**: Prime context MUST expose dispatchable agents separately from merely enabled registry rows
- **FR-007**: Prime decision contracts MUST allow intent-level work routing requests that specify work class, constraints, and desired outcome without requiring a raw capability string
- **FR-008**: System MUST provide remediation suggestions for blocked routing outcomes, including extending an existing agent, enabling or repairing a runtime, or creating a new template/agent definition
- **FR-009**: Investigation and escalation flows MUST use the same routing layer and MUST NOT bypass executable-route checks
- **FR-010**: Durable staff agents MUST either have a supported runnable execution model or be excluded from dispatchable routing until such a model exists
- **FR-011**: System MUST deduplicate repeated blocked-routing artifacts for the same unresolved work item, thread, and blocker signature
- **FR-012**: Routing policy MUST be evolvable independently of Prime prompt wording so the same Prime intent can resolve differently as the fleet model improves

### Key Entities

- **Registered Agent**: An agent row that exists in ACP with identity, role, configuration, and declared capabilities, regardless of current runtime state
- **Dispatchable Agent**: A registered agent that currently has a healthy runnable harness and can accept work immediately
- **Spawnable Template**: A versioned agent template that can be instantiated on demand to satisfy a work request even if no durable agent is currently dispatchable
- **Routing Request**: A Prime-generated intent record describing desired work class, scope, constraints, and optional preferred role without selecting a concrete target
- **Routing Outcome**: The backend-produced result of evaluating a routing request against current executable capacity and policy
- **Capability Gap**: A named absence where no dispatchable or spawnable target can satisfy a requested work class under current policy
- **Runtime Availability**: The current health and executability state for a registered agent or template-backed runtime path

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero queued delegations are created for targets that have no executable runtime path
- **SC-002**: Prime room responses accurately distinguish successful delegation, spawn, blocked routing, and investigation outcomes
- **SC-003**: Repeated Prime turns encountering the same unresolved routing blocker do not create duplicate pending or investigation work items
- **SC-004**: A mixed fleet with disabled, errored, and healthy agents produces context that correctly classifies each target's executable status
- **SC-005**: At least one investigation flow can complete end-to-end through a runnable target or spawn path without manual DB repair

## Assumptions

- Prime remains a backend singleton orchestrator rather than an `agents` table row
- The routing layer is a backend control-plane primitive, not a user-visible durable staff persona
- Existing Prime event loop, work item model, and delegation tables remain the implementation basis unless a later approved spec revises them
- Capability bundles and tool grants remain governed by spec 009 and should not be redefined here
- Durable staff roles such as `SRE`, `Architect`, and `DevOps` may continue to exist as named roles, but they are not considered dispatchable unless their runtime path is proven executable
