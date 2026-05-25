# Feature Specification: Agent Lifecycle + Sandbox Isolation Primitive

**Feature Branch**: `002-agent-lifecycle-and-sandbox`

**Created**: 2026-05-21

**Status**: Draft

**Input**: "Define the foundational agent runtime primitive for ACP: what an agent record is, how durable and ephemeral agents run inside the harness, what isolation guarantees apply, and how the system recovers from restarts."

## Summary

This spec defines the single runtime model for non-Prime agents in ACP. Prime remains a native backend service and is not implemented as an `agents` table row. All other agents run inside the harness container under one shared runtime contract:

- **Durable agents** are long-lived supervised harness processes that survive restarts and retain persistent worktrees.
- **Ephemeral agents** are task-scoped harness processes spawned on demand and reaped after completion.
- **Both durable and ephemeral agents use the same harness runner interface** so task dispatch, tool-grant resolution, logging, restart handling, and future container migration share one contract.

Phase A implementation basis: the harness uses the existing local `AgentHarness` abstraction, with a direct in-process runner implementation as the primary execution path for both durable and ephemeral agents. Prime delegates work through DB-backed work items and delegations into this harness; it does not become a worker process itself.

## Key Decisions (Do Not Re-Open Without Amending the Constitution)

- **Deployment shape**: ACP remains a two-container system for this phase: `db` + `harness`
- **Prime runtime**: Prime is a native backend service, not an `agents` table row and not a harness-managed worker
- **Non-Prime runtime**: Durable and ephemeral agents both run through the same `AgentHarness` contract inside the harness container
- **Execution model**: Durable agents are supervised long-lived local processes; ephemeral agents are on-demand task processes using the same runner family
- **Ephemeral persistence model**: Ephemeral agents are concrete short-lived `agents` rows with full lifecycle tracking, not invisible transient runtime objects
- **Isolation contract**: Every non-Prime agent gets a dedicated git worktree, dedicated workdir, scoped env, per-run tool grant, resource limits, and broker-mediated credentials
- **Coordination primitive**: ACP's database is the source of truth for runtime state, assignments, and recovery
- **Failure model**: Harness crash kills all non-Prime agents; on restart, the supervisor rebuilds durable state from the DB and marks interrupted in-flight work as `error`
- **Migration seam**: Future per-agent containers MUST preserve the same `AgentHarness` behavior and DB contracts

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Spawn and complete an isolated ephemeral task (Priority: P1)

When Prime delegates a task to an ephemeral specialist, ACP should provision an isolated workspace, run the task through the shared harness runner, collect structured output, and tear the agent down cleanly.

**Why this priority**: This is the minimum viable primitive for any delegated work in ACP. Without it, Prime cannot safely offload implementation tasks.

**Independent Test**: Can be fully tested by queuing one delegation to an eligible ephemeral agent and verifying the harness provisions the workspace, runs the task, returns a result, and performs teardown without leaving the task or workspace in an indeterminate state.

**Acceptance Scenarios**:

1. **Given** an enabled ephemeral agent template and a queued delegation, **When** the dispatcher assigns the work, **Then** the harness provisions the agent workspace, starts the runner, executes the task, and marks the delegation completed or failed with structured output
2. **Given** an ephemeral task finishes successfully, **When** teardown runs, **Then** credentials are revoked, the ephemeral workdir is purged, and the agent record transitions to `terminated`
3. **Given** an ephemeral task attempts work outside its allowed scope, **When** ACP evaluates the task result, **Then** the delegation is marked failed and the violation is recorded

---

### User Story 2 - Keep durable staff available across restarts (Priority: P2)

When ACP boots or the harness restarts, durable staff agents should be reconstructed from DB state and returned to service without duplicate provisioning.

**Why this priority**: ACP cannot function as an always-on personal staff if durable roles disappear or duplicate themselves after restarts.

**Independent Test**: Can be tested by provisioning the durable staff once, restarting the harness, and verifying the same agent identities come back in a healthy ready/idle state with the same persistent worktrees and tool assignments.

**Acceptance Scenarios**:

1. **Given** durable staff records already exist, **When** the harness starts, **Then** it recreates or reattaches their supervised runtime processes without inserting duplicate agent rows
2. **Given** a durable agent was `busy` when the harness crashed, **When** the supervisor rebuilds state, **Then** the interrupted task is marked `error` and the durable agent returns to a recoverable state
3. **Given** a durable agent exits unexpectedly while the harness is running, **When** the supervisor detects the exit, **Then** it attempts restart under the configured retry policy and records the failure if recovery does not succeed

---

### User Story 3 - Enforce cross-agent isolation (Priority: P3)

When multiple agents run concurrently, each one should be restricted to its own worktree, scoped tool grant, and scoped credentials.

**Why this priority**: Isolation is a constitutional requirement and the main reason to build the harness primitive before higher-level staffing features.

**Independent Test**: Can be tested by running two concurrent agents with different workdirs and tool grants and verifying neither can read or modify the other's workspace or use ungranted tools.

**Acceptance Scenarios**:

1. **Given** two concurrent agents with different worktrees, **When** one agent attempts to access files outside its assigned workspace, **Then** the attempt is denied or the resulting task is failed as an isolation violation
2. **Given** an agent resolves to a narrow tool grant, **When** its runtime config is written, **Then** only the provider adapters and control-plane primitives included in that grant are exposed to it
3. **Given** short-lived credentials are issued for a task-scoped agent, **When** the task ends, **Then** those credentials are revoked and no longer usable

---

### User Story 4 - Prime delegates without becoming a worker (Priority: P4)

When Prime decides to delegate work, it should write work items and delegations into the DB and let the harness execute them, while Prime itself remains a native orchestration service.

**Why this priority**: This prevents the new design from regressing into the rejected "Prime as worker row" model and cleanly separates orchestration from execution.

**Independent Test**: Can be tested by sending a Prime message that creates a delegation and verifying the work enters the shared queue, is picked up by the harness, and completes without any Prime entry in the `agents` table.

**Acceptance Scenarios**:

1. **Given** Prime creates a delegation, **When** the dispatcher polls queued work, **Then** it routes the work to a harness-managed non-Prime agent
2. **Given** ACP is operating normally, **When** the system enumerates worker agents, **Then** Prime is not represented as a harness-managed `agents` row

---

### Edge Cases

- What happens when a durable agent exists in the DB but its worktree path is missing or corrupted on disk?
- What happens when two bootstrap paths race to provision the same durable role?
- How does the harness behave when the configured provider for an agent is missing, disabled, or has no usable API key?
- What happens when the harness restarts while an ephemeral agent is in teardown?
- How does ACP mark state when an agent starts successfully but never becomes healthy enough to accept work?
- What happens when MCP assignment changes while a durable agent is already running?
- What happens when a capability profile changes while a durable agent is already running a task?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST preserve Prime as a native backend service outside the harness-managed agent fleet
- **FR-002**: System MUST represent all non-Prime agents in the `agents` table and extend that model rather than introducing a second competing worker registry
- **FR-003**: System MUST classify each non-Prime agent by `tier` with values `durable` or `ephemeral`
- **FR-004**: System MUST record each non-Prime agent's `role`, `state`, `persona_file`, `worktree_path`, `workspace_root`, `runtime_family`, `execution_mode`, `enabled` flag, and timestamps required for lifecycle and recovery
- **FR-005**: System MUST support the lifecycle states `provisioning`, `ready`, `busy`, `idle`, `retiring`, `terminated`, and `error` for non-Prime agents
- **FR-006**: System MUST enforce valid lifecycle transitions:
  - `provisioning -> ready` after workspace and runtime are prepared
  - `ready -> busy` when work is claimed
  - `busy -> idle` for durable agents after task completion
  - `busy -> retiring` for ephemeral agents after task completion begins teardown
  - `idle -> busy` for durable agents when new work is assigned
  - `idle -> retiring` when a durable agent is intentionally removed
  - `retiring -> terminated` after cleanup succeeds
  - `any active state -> error` when provisioning, dispatch, health, or teardown fails
- **FR-007**: System MUST use one shared harness runner contract for durable and ephemeral agents, implemented through the existing `AgentHarness` abstraction or an interface-compatible successor
- **FR-008**: System MUST use the same runner family for durable and ephemeral agents in Phase A; durable staff are not allowed to use one execution stack while ephemerals use a different one
- **FR-009**: System MUST provision durable agents as supervised long-lived local harness processes that are started at bootstrap and remain available for repeated task dispatch
- **FR-010**: System MUST provision ephemeral agents as task-scoped harness processes that are started on demand and reaped after their assigned work completes
- **FR-011**: System MUST create or reuse a dedicated git worktree for every non-Prime agent
- **FR-012**: System MUST create a dedicated workspace root for every non-Prime agent under the harness-managed agents directory
- **FR-013**: System MUST resolve a per-run `Tool Grant` for each agent execution from role, task scope, approval state, and environment
- **FR-014**: System MUST expose platform primitives and provider adapters to an agent only when they are included in that agent's resolved tool grant
- **FR-015**: System MUST support layered tool resolution in which capability bundles map to one or more provider adapters without changing the agent-facing task contract
- **FR-016**: System MUST write per-agent runtime configuration files into the agent's workspace before the agent is started
- **FR-017**: System MUST inject only the environment variables required for that agent's provider adapters, control-plane access, and broker-issued credentials
- **FR-018**: System MUST apply a resource-limits profile at spawn time, with ephemerals stricter than durables for CPU, memory, wall-clock, and concurrent process allowances
- **FR-019**: System MUST prevent one agent from reading, writing, or diffing another agent's worktree as part of normal operation
- **FR-020**: System MUST record structured lifecycle and task logs tagged with `agent_id`, `task_id` when present, `timestamp`, `level`, and `message`
- **FR-021**: System MUST record enough runtime metadata to diagnose start failures, crashes, retries, tool-grant resolution, and teardown outcomes without relying on transient process stdout alone
- **FR-022**: System MUST expose a supervisor restart path that reconstructs durable agents from persisted DB state on harness boot
- **FR-023**: System MUST mark in-flight delegations interrupted by harness crash or process death as failed with an explicit error outcome
- **FR-024**: System MUST move interrupted agents to `error` during recovery before returning them to `ready` or `idle`
- **FR-025**: System MUST define a bounded retry policy for unexpected durable-agent exits and persist restart failure details when retries are exhausted
- **FR-026**: System MUST treat missing provider configuration, failed health checks, workspace provisioning errors, runtime boot failures, and unresolved tool grants as provisioning errors that prevent the agent from entering `ready`
- **FR-027**: System MUST allow capability-profile, tool-grant-input, and persona updates to be reconciled onto durable agents without creating duplicate agent identities
- **FR-028**: System MUST revoke or invalidate task-scoped credentials during ephemeral teardown
- **FR-029**: System MUST purge ephemeral workdirs on teardown unless retention is explicitly enabled for debugging
- **FR-030**: System MUST preserve durable worktrees and durable workspace state across normal restarts
- **FR-031**: System MUST keep Prime-to-worker handoff DB-backed via `work_items`, `delegations`, and queue state; Prime MUST NOT directly invoke worker runtime internals
- **FR-032**: System MUST define the integration seam for future credential-broker behavior even if Phase A begins with a minimal local implementation
- **FR-033**: System MUST define the integration seam for future per-agent container migration without requiring Prime or higher-level delegation semantics to change
- **FR-034**: System MUST be implementable by extending the current ACP schema and runtime components, including `agents`, `agent_runtime_configs`, `agent_mcp_assignments`, `delegations`, and the fleet dispatcher, rather than replacing them wholesale

### Storage Model

- **SM-001**: `agents` is the canonical identity table for all non-Prime workers, including durable staff and short-lived ephemerals
- **SM-002**: Phase A extends `agents` with at least `tier`, `role`, `state`, and `persona_file`
- **SM-003**: `agent_runtime_configs` stores runtime-level policy references for an agent, including capability-profile linkage and workspace/runtime defaults
- **SM-004**: Ephemeral agents are inserted as concrete `agents` rows before provisioning begins, transition through the same lifecycle state machine as durables, and remain queryable for audit after termination
- **SM-005**: A per-run `tool_grants` store, or an interface-equivalent persisted structure, records the resolved grant for a specific execution with granted primitives, granted capability bundles, selected provider adapters, exclusion reasons, and revocation state
- **SM-006**: Lifecycle and grant-resolution persistence MUST be designed so an interrupted run can be diagnosed without reconstructing state from transient runtime config files alone

### Terminology Lock

- **TL-001**: `routing capability` means the delegation/routing label used by Prime to select the right worker type for a task, such as `implementation`, `verification`, `research`, or `deployment`
- **TL-002**: `tooling capability bundle` means the least-privilege policy bundle used to derive tool access for a run, such as `repo.read`, `repo.write`, `ci.inspect`, `kb.search`, or `deploy.staging`
- **TL-003**: `provider adapter` means the concrete tool implementation behind a tooling capability bundle, such as an MCP server, CLI wrapper, HTTP API, or SDK-backed local integration
- **TL-004**: The existing `delegations.capability` field is the Phase A home of the `routing capability` concept; it is not the full tool-grant policy object
- **TL-005**: Tool-grant resolution consumes routing context and produces tooling capability bundles and provider adapters; these concepts MUST NOT be used interchangeably in implementation or UI copy

### Control-Plane Primitive Rules

- **CP-001**: Control-plane primitives participate in tool-grant resolution and are filtered into agent runtime configuration just like provider adapters
- **CP-002**: Server-side authorization remains mandatory for every control-plane primitive call even when the primitive is present in the runtime config
- **CP-003**: Some control-plane primitives MAY be broadly available to non-Prime agents, but Prime-only primitives MUST remain excluded from all non-Prime tool grants
- **CP-004**: Least-privilege for control-plane primitives is enforced at two layers: config-time grant filtering and request-time authorization

### Key Entities *(include if feature involves data)*

- **Agent Record**: A DB-backed representation of a non-Prime worker identity, including role, tier, lifecycle state, workspace metadata, runtime settings, and enablement
- **Routing Capability**: The delegation label used to choose what type of worker should handle a task
- **Durable Agent**: A long-lived non-Prime worker such as Architect, SRE, or DevOps that retains a persistent identity and worktree across tasks and restarts
- **Ephemeral Agent**: A task-scoped non-Prime worker that exists only for the duration of a delegated assignment
- **Agent Harness**: The shared execution contract used to start, dispatch work to, observe, abort, and close both durable and ephemeral runners
- **Capability Profile**: The policy description attached to a role or task type that determines which platform primitives and capability bundles may be granted
- **Tooling Capability Bundle**: The least-privilege policy bundle that describes what kinds of tool access a run may receive
- **Provider Adapter**: The concrete implementation selected to satisfy one or more tooling capability bundles
- **Tool Grant**: The resolved per-run tool exposure for a specific agent execution
- **Sandbox**: The enforced boundary around each non-Prime agent: worktree, workdir, scoped env, tool grant, credentials, and resource limits
- **Delegation**: A DB-backed unit of assigned work linking Prime or another agent to a target non-Prime agent through the dispatcher and harness
- **Supervisor**: The harness-side component that provisions agents, keeps durable agents running, rebuilds state after restart, and records failures
- **Credential Lease**: A short-lived set of secrets or tokens issued to a specific agent/task scope and revoked on teardown or expiry

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A queued delegation to an eligible ephemeral agent can be executed end-to-end with isolated workspace provisioning, structured result capture, and teardown completion
- **SC-002**: After a harness restart, previously provisioned durable agents are restored without duplicate agent records or duplicate worktrees
- **SC-003**: Interrupted in-flight tasks are surfaced as explicit failures rather than remaining indefinitely queued or in progress
- **SC-004**: Two concurrently running agents with different worktrees and tool assignments cannot successfully complete cross-scope access without ACP recording an isolation failure
- **SC-005**: Durable staff can remain available for repeated assignments without requiring reprovisioning between tasks
- **SC-006**: Prime can create delegations that are executed by harness-managed workers without any Prime identity being registered as a worker row

## Assumptions

- Phase A Prime implementation from spec `001` remains the orchestration basis and is completed before this feature ships
- ACP continues to use the existing Postgres-backed migration pattern in `backend/src/db.ts`
- The current `agents` table and related runtime tables are the baseline model to extend for lifecycle state, role/tier metadata, and recovery fields
- The existing dispatcher and `AgentHarness` abstraction are the implementation seam for task execution
- Phase A may begin with a minimal local credential-leasing path as long as the handshake and teardown contract support a later dedicated broker
- Persona files continue to live as workspace files written into each agent's worktree
- The primary runner in this phase is a direct local harness implementation inside the harness container, not per-agent Docker containers or remote hosts
- Rich live interaction from the circuit canvas is out of scope for this spec
