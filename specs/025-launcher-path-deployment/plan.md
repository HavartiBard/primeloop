# Implementation Plan: Runtime Harness Container Isolation — Deploy the Launcher Path

**Branch**: `[025-launcher-path-deployment]` | **Date**: 2026-06-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/025-launcher-path-deployment/spec.md`

## Summary

Make launcher-managed OpenSandbox runtimes the default execution path for managed local OpenCode agents in single-host Docker Compose deployments. The backend remains the owner of agent records, worktree lifecycle, and durable recovery state; a launcher service becomes responsible for provisioning one persistent isolated runtime container per managed local agent, exposing a remote ACP session endpoint for the harness flow, enforcing containment boundaries, and cleaning up runtime resources during restart and teardown. Pi-as-remote-harness work is deferred.

## Technical Context

**Language/Version**: TypeScript on Node.js 22 for backend services; React + TypeScript for operator UI

**Primary Dependencies**: Express backend, PostgreSQL via `pg`, ACP client/harness stack with remote transport support, Docker Compose deployment, OpenSandbox runtime service, launcher service

**Storage**: PostgreSQL for durable records and runtime state; filesystem worktrees under `/workspace/agents`; OpenSandbox-managed runtime container state

**Testing**: Vitest for backend/unit coverage, route/integration tests with Supertest-style patterns, targeted deployment verification via Docker Compose and runtime health checks

**Target Platform**: Single-tenant Linux server deployed with Docker Compose

**Project Type**: Full-stack web application with backend control plane and bundled frontend

**Performance Goals**: Runtime provisioning should make a managed local agent dispatchable within 30 seconds on a healthy host; runtime health state changes should become visible to the backend within 10 seconds; restart/teardown operations should either complete or surface an actionable failure within 30 seconds

**Constraints**: Default-on for managed local OpenCode agents in phase 1; backend exclusively owns worktree creation/reset/mutation; one persistent isolated runtime container per managed local agent; raw provider secrets must never be written into worktrees; containment must include scoped filesystem plus default-deny egress via a launcher/OpenSandbox-controlled boundary; deployment target remains Docker Compose, not Kubernetes; Pi remote harness is out of scope for phase 1

**Scale/Scope**: Single-tenant deployment with tens of managed local agents, each mapped to one persistent isolated runtime container; phase 1 scope limited to launcher service, OpenSandbox deployment, OpenCode runtime image/build, remote ACP transport, backend integration, compose wiring, recovery/teardown path, and docs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code quality**: Preserve current control-plane ownership boundaries by keeping backend responsibilities explicit (records, worktrees, recovery) and launcher responsibilities explicit (runtime provisioning, health, containment). Prefer incremental changes in `process-manager`, deployment wiring, and runtime-health surfaces rather than introducing broad cross-cutting abstractions.
- **YAGNI**: The launcher plus OpenSandbox-backed runtime path is justified because container isolation and remote ACP harnessing are the active requirements and cannot be achieved safely by extending backend-local process spawning. No broader scheduler, orchestrator, or multi-host placement layer is introduced in phase 1.
- **SRE readiness**: The design must add launcher health, OpenSandbox reachability, runtime provisioning status, restart/teardown outcomes, launcher-auth failures, and recovery outcomes as observable signals. Rollback to the prior runtime mode must be documented even though phase 1 becomes default-on for OpenCode.
- **UX consistency**: Any operator-visible status must reuse existing runtime/agent lifecycle language and distinguish clearly between legacy backend-managed local runtimes and launcher-managed isolated runtimes.
- **Visual polish**: UI changes, if any, should be minimal and reuse existing runtime status surfaces. No new visual pattern is required for phase 1.
- **Primeloop architecture constraints**: Prime remains the steering interface; durable DB records remain the source of truth; per-agent isolation is strengthened, not relaxed; single-tenant scope is unchanged.
- **Decoupled, replaceable runtime**: Backend continues to talk to runtimes only through ACP harness/session contracts. Launcher-managed runtimes must be killable and recreatable, and restart recovery must resolve through durable recovery state rather than hidden in-memory assumptions.
- **Runtime containment**: Phase 1 must explicitly enforce both dimensions of containment: worktree-scoped filesystem mounts and default-deny egress owned by the launcher/runtime boundary. Secrets, backend source, and direct DB credentials must remain unreachable from inside the runtime container.
- **Complexity tracking**: One new service (launcher) and one new deployment shape are introduced. This is constitutionally acceptable because it directly satisfies the containment requirement and is constrained to current Docker Compose deployment.

**Post-Design Re-check**: Pass expected if implementation remains limited to a single launcher service, a minimal launcher API contract, backend-owned worktree lifecycle, and observable recovery/rollback behavior.

## Project Structure

### Documentation (this feature)

```text
specs/025-launcher-path-deployment/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── launcher-api.yaml
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── acp/
│   ├── credentials/
│   ├── fleet-executor/
│   ├── opencode/
│   ├── recovery/
│   ├── routes/
│   └── runtime/
└── tests/

web/
├── src/
│   ├── components/
│   ├── hooks/
│   └── pages/
└── tests/

docker-compose.yml
docker-compose.dev.yml
docker-compose.prod.yml
AGENTS.md
```

**Structure Decision**: Use the existing backend/web split. The launcher and OpenSandbox services will be added as deployment/runtime concerns alongside the backend rather than as a broad repository restructuring. Planning artifacts define the launcher contract, remote ACP transport boundary, and runtime lifecycle without redesigning unrelated PrimeLoop areas.

## Phase 0: Research

### Research Goals

1. Confirm the safest default-on rollout shape for launcher-managed OpenSandbox runtimes in a Docker Compose deployment.
2. Resolve the lifecycle boundary between backend-owned worktrees and launcher/OpenSandbox-owned runtime containers.
3. Define the minimal launcher API surface and remote ACP transport support needed to support OpenCode harness behavior.
4. Define the containment model required for filesystem scoping, secret handling, and default-deny egress.
5. Define recovery and rollback behavior for the default-on transition.

### Research Output

- [research.md](./research.md)

## Phase 1: Design & Contracts

### Design Outputs

- [data-model.md](./data-model.md)
- [contracts/launcher-api.yaml](./contracts/launcher-api.yaml)
- [quickstart.md](./quickstart.md)

### Design Focus

1. Model the persistent launcher slot/runtime relationship per managed local OpenCode agent.
2. Define lifecycle transitions for provisioning, ready, unhealthy, reprovisioning, teardown, and recovery.
3. Define launcher request/response contracts for provision, inspect, restart, delete, and health, including remote ACP endpoint details.
4. Define deployment and verification steps for Docker Compose with OpenSandbox.
5. Update agent context so repository guidance points to this plan.

## Phase 2: Planning Readiness

The feature is ready for task decomposition once:

- research decisions are captured with rationale and rejected alternatives,
- data model and state transitions are explicit,
- launcher API contract and remote ACP transport expectations are documented,
- quickstart covers deployment, validation, and rollback,
- `AGENTS.md` points to this plan.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New launcher service plus OpenSandbox runtime backend | Required to move managed local OpenCode runtimes into isolated containers while preserving backend-owned control logic | Keeping runtime spawning in the backend cannot satisfy the required runtime containment boundary |
| Default-on phase-1 rollout for OpenCode | Needed to close the architecture/deployment gap rather than leaving isolation as an unused optional path | Opt-in rollout would preserve the mismatch between intended architecture and normal deployment behavior |
