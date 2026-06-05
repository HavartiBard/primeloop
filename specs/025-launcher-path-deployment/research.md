# Research: Runtime Harness Container Isolation — Deploy the Launcher Path

## Decision 1: Phase 1 rollout is default-on for managed local OpenCode agents

- **Decision**: Make launcher-managed runtime isolation the default execution path in phase 1 for managed local OpenCode agents.
- **Rationale**: The feature exists to close the gap between intended architecture and deployed reality. Keeping isolation opt-in would leave the current deployment mismatch intact and reduce confidence that containment is actually used.
- **Alternatives considered**:
  - **Opt-in behind a flag**: Rejected because it prolongs the architecture/deployment gap and makes verification less meaningful.
  - **Default-on only for new deployments**: Rejected because it creates two operational modes for the same runtime families and increases support complexity.

## Decision 2: One persistent isolated runtime container per managed local agent

- **Decision**: Provision one persistent runtime container per managed local agent rather than a fresh container per task.
- **Rationale**: This aligns with the current harness/session model, reduces integration risk, and supports restart/recovery semantics without redesigning dispatch around per-task runtime churn.
- **Alternatives considered**:
  - **Fresh container per task**: Rejected because it would force broader changes to session, recovery, and lifecycle semantics in phase 1.
  - **Persistent only for durable agents**: Rejected because mixed runtime semantics would complicate launcher behavior and acceptance testing.

## Decision 3: Backend exclusively owns worktree lifecycle

- **Decision**: The backend remains exclusively responsible for creating, resetting, and mutating worktrees; the launcher only mounts the backend-assigned worktree into the runtime container.
- **Rationale**: This preserves an existing trust boundary and keeps the isolation project focused on runtime containment rather than repo ownership redesign.
- **Alternatives considered**:
  - **Launcher creates worktrees during provisioning**: Rejected because it splits repository ownership across services and complicates failure handling.
  - **Launcher fully owns worktrees**: Rejected because it broadens scope and risks hidden repository mutations inside the isolation boundary.

## Decision 4: Minimal launcher API with explicit lifecycle verbs and remote ACP endpoint output

- **Decision**: Expose a small launcher API for health, provision, inspect, restart, and teardown operations, returning a remote ACP session endpoint and runtime status payloads.
- **Rationale**: The backend should talk to remote runtimes over ACP rather than treat a remote endpoint like a local spawned process. Standardizing on OpenCode keeps the remote harness target simple.
- **Alternatives considered**:
  - **Generic scheduling API**: Rejected as unnecessary in single-host Compose scope.
  - **Backend shelling directly into the container runtime**: Rejected because it weakens separation of responsibilities and observability.

## Decision 5: Containment is enforced by launcher-owned OpenSandbox boundary plus allowlisted egress control

- **Decision**: Launcher-managed OpenSandbox runtime containers receive only the assigned worktree and brokered runtime credentials, and launcher-managed policy enforces default-deny outbound access with explicit allowlisting.
- **Rationale**: The constitution requires two-dimension containment: scoped filesystem plus default-deny egress through a control point runtimes cannot bypass.
- **Alternatives considered**:
  - **Filesystem scoping only**: Rejected because it does not satisfy constitutional containment requirements.
  - **Allow all network egress during phase 1**: Rejected because it undermines blast-radius reduction.

## Decision 6: Recovery resolves through durable backend state, not launcher-local assumptions

- **Decision**: After backend restart, the system must inspect launcher state and either reattach, reprovision, or explicitly record an unavailable/recovery outcome using backend durable records.
- **Rationale**: Replaceable runtimes are a constitutional requirement, and restart handling cannot rely on opaque in-memory launcher state.
- **Alternatives considered**:
  - **Assume containers survive and are still valid**: Rejected because it risks silent failure and stale session endpoints.
  - **Always destroy and recreate all runtimes on backend restart**: Rejected because it discards potentially recoverable state and creates unnecessary churn.

## Decision 7: OpenCode is the only phase-1 remote harness target

- **Decision**: Standardize on OpenCode as the phase-1 remote harness target and defer Pi-as-remote-harness work.
- **Rationale**: Carrying both Pi and OpenCode as first-class remote harness targets increases transport, lifecycle, and deployment complexity before the launcher/OpenSandbox path is stable. OpenCode already aligns better with containerized sandbox guidance.
- **Alternatives considered**:
  - **Support Pi and OpenCode equally in phase 1**: Rejected because it multiplies runtime image, ACP transport, and recovery complexity.
  - **Use Pi as the primary remote harness target**: Rejected because it adds a second major harness direction without clear phase-1 benefit.

## Decision 8: Rollback remains documented even though launcher path is default-on

- **Decision**: The plan must include a documented rollback mode to the prior backend-managed local runtime path in case deployment validation fails.
- **Rationale**: Default-on rollout increases the need for safe recovery during adoption, even if the rollback path is temporary and operational rather than the intended steady state.
- **Alternatives considered**:
  - **No rollback path**: Rejected because it would create unacceptable operational risk for a deployment-shape change.
