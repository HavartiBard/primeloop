# Feature Specification: Prime Empty Fleet Graceful Degradation

**Feature Branch**: `001-prime-empty-fleet-graceful-delegation`

**Created**: 2026-05-21

**Status**: Draft

**Input**: "The Prime agent has a hard rule to delegate work but there are no available agents in the fleet, so it gets stuck trying to produce delegation actions with no valid targets."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Prime responds helpfully when no agents are available (Priority: P1)

When a user sends a message to Prime and no fleet agents are available, Prime should respond conversationally and explain the situation rather than getting stuck trying to delegate to non-existent agents.

**Why this priority**: This is the core bug — without it, Prime is completely non-functional in the most common deployment state (Phase A with no worker agents yet).

**Independent Test**: Can be fully tested by sending a `prime.message` event to Prime when the fleet has zero agents and verifying that Prime returns a valid decision with a meaningful response and no failed delegation actions.

**Acceptance Scenarios**:

1. **Given** the fleet has zero agents, **When** a user sends a task request to Prime, **Then** Prime responds with a conversational message explaining it will handle the task directly or track it for later
2. **Given** the fleet has zero agents, **When** a user sends a task request to Prime, **Then** Prime does NOT emit a `delegate` action targeting a null agent
3. **Given** the fleet has zero agents, **When** a cron event triggers Prime, **Then** Prime performs a `no_op` with a reason noting the empty fleet

---

### User Story 2 - Prime explicitly tracks un-delegatable work (Priority: P2)

When Prime receives a task that would normally be delegated but no agent is available, it should create a work item in a pending state so the task is not lost and can be picked up when agents become available.

**Why this priority**: Ensures no user requests are silently dropped when the fleet is empty. Provides a backlog that can be processed once agents are added.

**Independent Test**: Can be tested by sending a task to Prime with an empty fleet, then verifying a work item exists in `pending` status with appropriate metadata indicating it awaits agent availability.

**Acceptance Scenarios**:

1. **Given** the fleet has zero agents, **When** a user sends a task that requires specific capabilities, **Then** Prime creates a work item with status `pending` and metadata noting the required capability
2. **Given** a work item exists in `pending` status from an empty-fleet situation, **When** an agent with matching capabilities is added to the fleet, **Then** Prime can process it on the next cron cycle

---

### User Story 3 - Fleet status is clearly communicated in the system prompt (Priority: P3)

The `{{agents}}` section of Prime's system prompt should explicitly state when no agents are available, rather than rendering as a generic `- none` that the LLM may not interpret as a hard constraint.

**Why this priority**: Improves LLM reliability by making the empty-fleet condition unambiguous in the context window.

**Independent Test**: Can be tested by inspecting the generated system prompt when the fleet is empty and verifying it contains an explicit statement about agent availability.

**Acceptance Scenarios**:

1. **Given** the fleet has zero agents, **When** Prime builds its system prompt, **Then** the agents section contains explicit text stating no agents are currently available
2. **Given** the fleet has one or more agents, **When** Prime builds its system prompt, **Then** the agents section lists them normally without the empty-fleet notice

---

### Edge Cases

- What happens when all agents are disabled (fleet has agents but none are `enabled: true`)?
- How does Prime handle a task that requires approval vs one that requires delegation when fleet is empty?
- What happens during the transition from empty to non-empty fleet (agents added mid-conversation)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST prevent Prime from emitting `delegate` actions when no eligible agent exists for the requested capability
- **FR-002**: System MUST provide Prime with a clear empty-fleet indicator in its system prompt context
- **FR-003**: System MUST allow Prime to respond conversationally (via `response` field) without requiring any backend actions when delegation is impossible
- **FR-004**: System MUST create a tracked work item when a user task cannot be delegated due to empty fleet, so the request is not lost
- **FR-005**: Standing rules and Prime profile MUST include explicit guidance for the "no agents available" scenario

### Key Entities

- **Fleet State**: The set of available agents with their capabilities and enabled status, passed to Prime via `PrimeContext.fleet.agents`
- **Work Item**: A tracked unit of work with status (`pending`, `active`, `blocked`, etc.), lane, and metadata indicating source and required capability
- **System Prompt Template**: The template rendered for each LLM call, including the `{{agents}}` section that lists available fleet agents

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Prime returns a valid decision (no errors) when processing any event type with an empty fleet
- **SC-002**: Zero `delegate` actions are emitted targeting null/unassigned agents when fleet is empty
- **SC-003**: User-facing messages always include a meaningful `response` field explaining the situation
- **SC-004**: Work items created from undeliverable tasks are recoverable and processable when agents become available

## Assumptions

- The Prime agent operates as a backend service (not an `agents` table row) per Phase A design
- The fleet can legitimately be empty during normal operation (e.g., before worker agents are provisioned)
- Existing action dispatch logic in `actions.ts` and LLM router in `llm-router.ts` remain the implementation basis
- The standing rules and Prime profile are stored as workspace files (`.md`) that can be edited
