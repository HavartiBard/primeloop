# Feature Specification: Runtime Harness Container Isolation — Deploy the Launcher Path

**Feature Branch**: `[025-launcher-path-deployment]`

**Created**: 2026-06-05

**Status**: Draft

**Input**: User description: "Write a spec for “Runtime Harness Container Isolation — Deploy the Launcher Path”. Context: - PrimeLoop’s intended architecture is isolated per-runtime harness containers to reduce blast radius. - The current codebase has a partial launcher/runtime-container path behind `EGRESS_SANDBOX=1`, but the default deployment still appears to run backend-managed local runtimes/worktrees. - Default compose does not currently deploy a launcher/runtime-container service. - We need to close the gap between intended architecture and actual deployment. Goal: Make per-runtime harness isolation the real deployed path for managed local agents, instead of a partial flagged path."

## Clarifications

### Session 2026-06-05

- Q: For phase 1, should launcher-managed runtime isolation be opt-in or the default path for managed local agents? → A: Default-on for managed local OpenCode agents in phase 1.
- Q: In phase 1, should each managed local agent get a persistent runtime container, or should the launcher create a fresh runtime container for every task? → A: One persistent isolated runtime container per managed local agent.
- Q: In phase 1, should the launcher be strictly forbidden from creating or mutating worktrees, or may it manage worktree setup as part of provisioning? → A: Backend exclusively creates, resets, and mutates worktrees; the launcher only mounts the assigned worktree.
- Q: For phase 1, should PrimeLoop standardize on one remote harness target or carry both Pi and OpenCode equally? → A: Standardize on OpenCode as the remote harness target and defer Pi-as-remote-harness work.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Isolated managed runtime deployment (Priority: P1)

As an operator deploying PrimeLoop, I need managed local agents to run inside isolated runtime harness containers instead of inside the backend-managed local runtime path, so a compromise or failure in one agent runtime has a narrower blast radius.

**Why this priority**: This is the core safety and architecture gap. Without it, the deployed system does not match the intended containment model.

**Independent Test**: Can be fully tested by deploying the system, creating a managed local OpenCode agent, and confirming that its runtime is provisioned through the launcher-managed isolated runtime path rather than directly by the backend process.

**Acceptance Scenarios**:

1. **Given** a fresh deployment using the current single-host container deployment model, **When** a managed local OpenCode agent is started, **Then** the system provisions an isolated runtime container through the launcher path and the backend connects to it through the returned ACP session endpoint.
2. **Given** a managed local OpenCode agent runtime is active, **When** another managed local OpenCode agent is started, **Then** the second runtime is isolated from the first and does not share the first agent’s writable worktree or raw credentials.
3. **Given** a managed local OpenCode agent is provisioned through the launcher path, **When** PrimeLoop dispatches work, **Then** dispatch flows over ACP to the remote runtime container rather than through a backend-spawned local stdio process.

---

### User Story 2 - Safe launcher lifecycle operations (Priority: P2)

As an operator, I need runtime creation, health monitoring, restart, and teardown to behave predictably through the launcher service so isolated runtimes remain operable without manual cleanup.

**Why this priority**: Isolation is only useful if the operational lifecycle remains reliable; otherwise the system becomes harder to run than the current path.

**Independent Test**: Can be fully tested by starting a managed local agent, observing a healthy runtime, forcing a restart or failure, and confirming the system recovers or reports a safe actionable failure state.

**Acceptance Scenarios**:

1. **Given** a managed local agent runtime has been provisioned, **When** the runtime becomes unhealthy or exits unexpectedly, **Then** the system detects the condition and either reprovisions or marks the agent unavailable with a clear operational reason.
2. **Given** a managed local agent is disabled or deleted, **When** teardown runs, **Then** the isolated runtime is stopped and its launcher-managed resources are cleaned up without leaving the agent in a false healthy state.
3. **Given** a backend restart occurs while managed local runtimes exist, **When** the system comes back up, **Then** it safely reattaches, reprovisions, or reports runtimes according to the defined recovery rules.

---

### User Story 3 - Clear deployment and migration path (Priority: P3)

As an operator upgrading from the current backend-managed local runtime deployment, I need a clear rollout path that explains how launcher-based isolation is enabled, validated, and rolled back so I can adopt it with confidence.

**Why this priority**: The feature changes the deployment shape. Operators need an explicit path from current state to target state to avoid partial adoption and confusing mixed modes.

**Independent Test**: Can be fully tested by following the documented rollout steps on an existing deployment and confirming the system reaches the isolated runtime path with a defined fallback path if validation fails.

**Acceptance Scenarios**:

1. **Given** an existing deployment using backend-managed local runtimes, **When** the rollout steps are followed, **Then** the deployment gains launcher-backed runtime isolation without requiring unrelated PrimeLoop reconfiguration.
2. **Given** the rollout validation detects a launcher or runtime failure, **When** the operator follows the documented fallback path, **Then** the deployment can return to the prior safe runtime mode without data loss in agent records or worktrees.

---

### Edge Cases

- What happens when the launcher service is reachable but cannot provision a runtime for a specific agent?
- What happens when the backend restarts after worktrees exist but before launcher-managed runtime state has been reconciled?
- What happens when runtime autodiscovery of health disagrees with backend state, such as a runtime container existing without a usable session endpoint?
- How does the system behave when a managed local agent is configured correctly but the launcher authentication token is missing or invalid?
- How does the system behave when a runtime container starts but cannot access its assigned worktree or starts with an unexpected writable mount?

## Constitution Alignment *(mandatory)*

- **Code Quality Plan**: Reuse the existing managed-agent lifecycle concepts, make current-state and target-state transitions explicit, and require focused verification for provisioning, dispatch, restart, teardown, and rollback paths.
- **YAGNI Check**: No unrelated runtime families, orchestration platforms, or UI redesigns are added in this phase. The feature is limited to closing the deployment gap for managed local OpenCode agents; Pi-as-remote-harness work is explicitly deferred.
- **Reliability & Operations**: The launcher path must emit clear provisioning, health, restart, teardown, and recovery signals. Failure states must distinguish launcher-auth issues, runtime startup failures, session endpoint failures, and cleanup failures. Operators must have a documented rollback path.
- **UX Consistency**: Operator-facing terminology must consistently distinguish current backend-managed local runtimes from isolated launcher-managed runtimes. Health, unavailable, cleanup, and recovery states must be understandable without reading code.
- **Design Consistency**: Reuse existing PrimeLoop operational status patterns, setup/runtime terminology, and managed-agent lifecycle surfaces. Any new runtime status messaging should fit existing operator-facing management views.
- **Primeloop Architecture Constraints**: This is an architectural change to managed local runtime deployment. It must preserve PrimeLoop’s durable agent records, worktree-based task isolation, brokered credential direction, and single-tenant operational model while shifting runtime execution into isolated launcher-managed containers.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST describe the current-state deployment gap by distinguishing between the existing backend-managed local runtime path and the intended launcher-managed isolated runtime path.
- **FR-002**: The system MUST define a launcher service as the runtime provisioner for phase-1 managed local agent isolation.
- **FR-003**: The system MUST support launcher-managed isolated runtimes for managed local agents using OpenCode as the remote harness target in phase 1.
- **FR-004**: Phase 1 MUST use one persistent isolated runtime container per managed local agent rather than creating a fresh runtime container for every task.
- **FR-005**: The system MUST define a single runtime lifecycle for launcher-managed agents covering provision, healthy ready state, dispatch availability, restart, teardown, and recovery after backend restart.
- **FR-006**: The system MUST require the backend to authenticate to the launcher before requesting runtime provisioning, restart, or teardown actions.
- **FR-007**: The system MUST define that only brokered or environment-scoped runtime credentials may enter isolated runtime containers.
- **FR-008**: The system MUST prohibit raw provider secrets from being written into agent worktree files as part of the isolated runtime path.
- **FR-009**: The backend MUST exclusively create, reset, and mutate worktrees for managed local agents in phase 1.
- **FR-010**: The launcher MUST NOT create, reset, or otherwise mutate worktrees; it may only mount the worktree assigned by the backend.
- **FR-011**: The system MUST define that each isolated runtime container mounts only its assigned writable worktree and any explicitly required runtime scratch paths.
- **FR-012**: The system MUST prohibit isolated runtime containers from mounting backend source, backend secret files, or direct database credentials.
- **FR-013**: The system MUST define network isolation expectations for isolated runtime containers, including the allowed egress model and the expected behavior when disallowed access is attempted.
- **FR-014**: The system MUST define the backend-to-launcher interaction needed to obtain a usable ACP session endpoint for a remote OpenCode runtime.
- **FR-015**: The system MUST define how health is determined for launcher-managed runtimes and how unhealthy runtimes are surfaced to operators.
- **FR-016**: The system MUST define restart behavior for launcher-managed runtimes, including when the system reattaches, reprovisions, or marks a runtime unavailable.
- **FR-017**: The system MUST define teardown behavior so disabling or deleting a managed local agent removes launcher-managed runtime resources and clears stale runtime status.
- **FR-018**: The system MUST define the deployment changes required to run the launcher path in the current single-host container deployment model, including the launcher service, runtime image expectations, and required environment configuration.
- **FR-019**: Phase 1 MUST make launcher-managed runtime isolation the default deployment path for managed local OpenCode agents, and MUST define the safeguards, rollout validation, and rollback guidance needed to support that default-on transition.
- **FR-020**: The system MUST define a migration path from current backend-managed local runtimes to launcher-managed isolated runtimes without requiring redesign of unrelated PrimeLoop subsystems.
- **FR-021**: The system MUST define rollout guidance that includes operator validation steps and a documented rollback path if launcher-backed isolation fails in deployment.
- **FR-022**: The system MUST constrain phase 1 to launcher service deployment, OpenSandbox-backed runtime provisioning, remote ACP transport for OpenCode, session endpoint integration with the existing harness flow, health/restart/cleanup behavior, and documentation updates.
- **FR-023**: The system MUST explicitly identify non-goals for phase 1 so cluster scheduling, unrelated runtime families, and broader PrimeLoop redesign are excluded from this feature.

### Key Entities *(include if feature involves data)*

- **Launcher Service**: The runtime provisioner responsible for creating, exposing, monitoring, and tearing down isolated runtime environments for managed local agents.
- **Isolated Runtime Container**: The persistent execution environment for one managed local agent, with its own runtime process, constrained mounts, network policy, and health state.
- **Managed Local Agent**: An agent using OpenCode as its remote harness target that should execute through the launcher-managed isolated runtime path.
- **Assigned Worktree**: The writable project subtree owned and managed by the backend for one managed local agent and mounted into only that agent’s isolated runtime container.
- **Session Endpoint**: The launcher-provided connection target that allows the backend harness flow to dispatch work into the isolated runtime.
- **Runtime Credential Scope**: The brokered, environment-scoped runtime secrets and tokens that are allowed inside the isolated runtime container.
- **Deployment Rollout State**: The operator-visible state describing whether a deployment is still on the legacy runtime path, using the launcher path, validating a rollout, or rolling back.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a fresh deployment, operators can start managed local OpenCode agents and verify that they run through isolated launcher-managed OpenSandbox runtimes instead of the legacy backend-managed runtime path.
- **SC-002**: For 100% of managed local agents created in the isolated phase-1 path, each agent receives one persistent isolated runtime container provisioned with only its assigned writable worktree and no direct backend source or database secret mount.
- **SC-003**: In rollout validation, operators can determine within 10 minutes whether the deployment is successfully using launcher-managed isolation or has failed back to a documented safe state.
- **SC-004**: In restart and teardown verification, the system successfully reattaches, reprovisions, or safely marks runtimes unavailable for all tested managed local agents without leaving false healthy state or orphaned runtime resources.
- **SC-005**: Operators can complete the documented migration from the current backend-managed local runtime path to the isolated launcher path, now defined as the default phase-1 path for managed local OpenCode agents, using the provided deployment and validation guidance without requiring manual code changes.

## Assumptions

- PrimeLoop will continue to use the current single-host container deployment model in phase 1 rather than introducing cluster orchestration.
- Existing durable agent records, worktree-based task flow, and harness dispatch concepts remain in place; this feature changes where managed local runtimes execute, not how delegations are modeled, and phase 1 keeps one persistent runtime container per managed local agent.
- Backend-owned worktree creation, reset, and mutation remain the safer default for phase 1 than moving repository ownership into the isolated runtime containers or launcher.
- Current brokered credential direction and secret-handling expectations remain valid and should be strengthened, not replaced, by runtime isolation.
- Phase 1 only needs to close the deployment gap for managed local OpenCode agents, which will move to the default launcher-managed isolated path; Pi-as-remote-harness work and other runtime families can remain on their existing paths until explicitly specified later.
- Existing operator-facing runtime status surfaces can be extended to communicate launcher-managed health and failure states without a broad UX redesign.
