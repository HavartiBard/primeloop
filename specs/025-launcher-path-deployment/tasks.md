# Tasks: Runtime Harness Container Isolation — Deploy the Launcher Path

**Input**: Design documents from `/specs/025-launcher-path-deployment/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Verification is required because the feature changes runtime transport, isolation, and deployment shape. Add implementation-facing tests where needed to prove each story independently.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g. US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Backend: `backend/src/`, `backend/tests/`
- Deployment: `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.prod.yml`
- Feature docs: `specs/025-launcher-path-deployment/`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the launcher/OpenSandbox scaffolding and OpenCode runtime deployment placeholders needed by all stories.

- [X] T001 Create launcher adapter structure for Docker/OpenSandbox backends in `backend/src/launcher/`
- [X] T002 Create OpenCode runtime image/bootstrap scaffolding for remote container execution in deployment/runtime build files
- [X] T003 [P] Add launcher/OpenSandbox environment placeholders and service stubs to `docker-compose.yml`, `docker-compose.dev.yml`, and `docker-compose.prod.yml`
- [X] T004 [P] Document launcher/OpenSandbox env vars, OpenCode runtime image expectations, and deployment prerequisites in `specs/025-launcher-path-deployment/quickstart.md` and `README.md`
- [X] T005 [P] Update feature contract/docs references to reflect OpenCode-first remote harness scope and Pi deferral

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T006 Implement launcher auth validation and request guards in `backend/src/launcher/auth.ts` and `backend/src/launcher/server.ts`
- [X] T007 [P] Implement launcher health reporting for selected adapter plus OpenSandbox reachability in `backend/src/launcher/health.ts`
- [X] T008 [P] Implement backend-side launcher API client/helpers for provision, inspect, restart, and teardown in `backend/src/runtime/launcher-client.ts`
- [X] T009 Implement transport abstraction in `backend/src/acp/client.ts` so ACP can run over local stdio and remote transport
- [X] T010 Implement remote ACP harness support in `backend/src/fleet-executor/acp-harness.ts` and related harness types
- [X] T011 [P] Add shared launcher/runtime/remote-session status types in `backend/src/runtime/types.ts` and `backend/src/runtime/lease.ts`
- [X] T012 Implement recovery outcome recording and runtime-state reconciliation helpers for launcher/OpenSandbox runtimes in `backend/src/recovery/` and `backend/src/runtime/`
- [X] T013 [P] Add observability hooks for launcher auth failure, provisioning, restart, teardown, remote ACP connect, and recovery outcomes in `backend/src/runtime-event-types.ts`, `backend/src/events/`, and `backend/src/index.ts`

**Checkpoint**: Launcher boundary, remote ACP transport, shared runtime types, and recovery hooks are ready; user story work can proceed.

---

## Phase 3: User Story 1 - Isolated OpenCode runtime deployment (Priority: P1) 🎯 MVP

**Goal**: Make launcher-managed OpenSandbox runtimes running `opencode serve` the default path for managed local OpenCode agents.

**Independent Test**: Bring up the Compose deployment, create/enable managed local OpenCode agents, and verify they receive launcher-provisioned persistent isolated runtimes with usable remote ACP session endpoints.

### Verification for User Story 1

- [X] T014 [P] [US1] Add backend tests for launcher-backed OpenCode runtime provisioning and ACP endpoint handoff in `backend/tests/opencode/process-manager.test.ts`
- [X] T015 [P] [US1] Add launcher API route tests for `POST /agents` and `GET /agents/{agentId}` in `backend/tests/launcher/launcher.route.test.ts`
- [X] T016 [P] [US1] Add ACP remote transport tests in `backend/tests/acp/` and `backend/tests/fleet-executor/`

### Implementation for User Story 1

- [X] T017 [P] [US1] Implement launcher POST `/agents` and GET `/agents/{agentId}` handlers in `backend/src/launcher/server.ts`
- [X] T018 [P] [US1] Implement launcher runtime lifecycle management through OpenSandbox in `backend/src/launcher/runtime-manager.ts` and `backend/src/launcher/adapters.ts`
- [X] T019 [US1] Implement OpenSandbox-backed OpenCode runtime provisioning contract and endpoint mapping in `backend/src/launcher/` and `specs/025-launcher-path-deployment/contracts/launcher-api.yaml`
- [X] T020 [US1] Update `backend/src/opencode/process-manager.ts` to make launcher-managed remote ACP provisioning the default path for managed local OpenCode agents
- [X] T021 [US1] Update `backend/src/index.ts` and `backend/src/app.ts` to boot the launcher service, surface launcher/OpenSandbox health, and wire default-on runtime mode configuration
- [X] T022 [US1] Enforce persistent one-runtime-per-agent behavior and backend-owned worktree assignment in `backend/src/opencode/process-manager.ts` and `backend/src/launcher/runtime-manager.ts`
- [X] T023 [US1] Ensure launcher-managed runtime status is surfaced through existing runtime/agent status paths in `backend/src/routes/runtime.ts`, `backend/src/routes/agents.ts`, and related runtime status surfaces
- [X] T024 [US1] Update Docker Compose service wiring and runtime image mounts so launcher-managed OpenSandbox runtimes can be provisioned in the default deployment path
- [X] T025 [US1] Update operator-facing runtime/install documentation for the new OpenCode-first default path in `README.md` and `specs/025-launcher-path-deployment/quickstart.md`

**Checkpoint**: Managed local OpenCode agents provision through launcher-managed persistent isolated OpenSandbox runtimes by default and are independently testable.

---

## Phase 4: User Story 2 - Safe launcher lifecycle operations (Priority: P2)

**Goal**: Ensure launcher-managed OpenCode runtimes support health monitoring, restart, teardown, and backend restart recovery without leaving stale or silent failure states.

**Independent Test**: Restart the backend and a managed runtime, force a runtime health failure, and disable/delete an agent; verify the system reattaches, reprovisions, or records explicit unavailable/cleanup outcomes with no false healthy state.

### Verification for User Story 2

- [X] T026 [P] [US2] Add backend recovery tests for launcher-managed runtime reconciliation in `backend/tests/recovery/restart.test.ts` and `backend/tests/opencode/process-manager.test.ts`
- [X] T027 [P] [US2] Add launcher restart/teardown route tests for `POST /agents/{agentId}/restart` and `DELETE /agents/{agentId}` in `backend/tests/launcher/launcher.route.test.ts`
- [X] T028 [P] [US2] Add remote ACP reconnect/replacement tests in `backend/tests/acp/` and `backend/tests/fleet-executor/`

### Implementation for User Story 2

- [X] T029 [P] [US2] Implement launcher restart and teardown handlers in `backend/src/launcher/server.ts` and `backend/src/launcher/runtime-manager.ts`
- [X] T030 [US2] Implement backend restart reconciliation against launcher/OpenSandbox state in `backend/src/recovery/restart.ts`, `backend/src/runtime/lease.ts`, and `backend/src/opencode/process-manager.ts`
- [X] T031 [US2] Record explicit recovery outcomes and remote ACP transition reasons in `backend/src/events/`, `backend/src/runtime/`, and `backend/src/recovery/`
- [X] T032 [US2] Add health degradation, reprovisioning, stale-runtime clearing, and remote endpoint replacement logic in `backend/src/launcher/health.ts`, `backend/src/runtime/launcher-client.ts`, and runtime status/recovery helpers
- [X] T033 [US2] Update operator-visible runtime/agent status responses to surface restart, teardown, and unavailable reasons consistently for diagnosis
- [X] T034 [US2] Extend `specs/025-launcher-path-deployment/quickstart.md` and `README.md` with restart, teardown, and rollback verification steps

**Checkpoint**: Launcher-managed OpenCode runtimes recover or fail explicitly under restart and teardown scenarios and remain independently testable.

---

## Phase 5: User Story 3 - Clear deployment and migration path (Priority: P3)

**Goal**: Provide a safe operator rollout from backend-managed local runtimes to launcher-managed OpenSandbox runtimes with clear validation and rollback guidance.

**Independent Test**: Follow the documented migration path on an existing deployment, validate launcher-managed isolation becomes active, then follow the rollback path and confirm the deployment can return to a safe prior mode.

### Verification for User Story 3

- [X] T035 [P] [US3] Add deployment-level verification coverage or scripted validation notes for migration/rollback expectations in `backend/tests/runtime/` and `specs/025-launcher-path-deployment/quickstart.md`

### Implementation for User Story 3

- [X] T036 [P] [US3] Implement migration-mode/runtime-mode compatibility checks in `backend/src/index.ts`, `backend/src/runtime/`, and `backend/src/opencode/process-manager.ts`
- [X] T037 [US3] Add rollout validation and rollback status signaling in `backend/src/routes/runtime.ts`, `backend/src/events/`, and `backend/src/runtime-event-types.ts`
- [X] T038 [US3] Document end-to-end migration, validation, and rollback procedures in `README.md` and `specs/025-launcher-path-deployment/quickstart.md`
- [X] T039 [US3] Update `AGENTS.md` and any feature-scoped operator guidance files that reference runtime isolation expectations for the new default deployment path

**Checkpoint**: Operators can adopt the launcher-managed OpenCode default path and execute the documented rollback flow independently.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final consistency, containment, and verification passes across all stories.

- [X] T040 [P] Review launcher contract, quickstart, and plan/spec consistency across `specs/025-launcher-path-deployment/spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, and `contracts/launcher-api.yaml`
- [X] T041 Audit runtime containment enforcement and secret-handling paths in `backend/src/launcher/`, `backend/src/credentials/`, `backend/src/opencode/`, and isolation-related tests
- [X] T042 [P] Review operator UX/status terminology for launcher-managed OpenCode runtimes across UI/runtime status responses
- [X] T043 Run the feature quickstart validation and record any required doc adjustments in `specs/025-launcher-path-deployment/quickstart.md` and `README.md`
- [X] T044 Review and explicitly document Pi-as-remote-harness deferral/non-goals in feature docs and operator guidance

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational completion
- **User Story 2 (Phase 4)**: Depends on User Story 1 runtime provisioning path being in place
- **User Story 3 (Phase 5)**: Depends on User Story 1 and User Story 2 because migration/rollback guidance requires the default path and lifecycle behavior to exist
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational completion — MVP
- **User Story 2 (P2)**: Requires launcher-managed default provisioning from US1
- **User Story 3 (P3)**: Requires default provisioning and lifecycle/recovery behavior from US1 and US2

### Within Each User Story

- Verification tasks should be authored before or alongside implementation and must fail or remain incomplete until the implementation lands
- ACP remote transport foundation before launcher/backend integration
- Launcher route handlers before backend integration where applicable
- Runtime status/recovery signaling before story closeout
- Documentation and operator guidance before closing the story

### Parallel Opportunities

- Setup tasks marked [P] can run in parallel
- Foundational tasks T007-T011 and T013 can run in parallel after T006 starts the launcher auth boundary
- In US1, T014-T016 and T017-T019 can run in parallel; T024-T025 can proceed after T020-T023 stabilize
- In US2, T026-T028 can run in parallel; T029 and T032 can run in parallel before T030-T031-T033 converge
- In US3, T035 and T036 can run in parallel before T037-T039
- In Polish, T040 and T042 can run in parallel; T041 and T043 depend on most implementation being present

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Prove a managed local OpenCode agent runs through a launcher-managed isolated OpenSandbox runtime using remote ACP
5. Demo/deploy the new default path before taking on advanced lifecycle and migration work

### Suggested MVP Scope

- **MVP**: User Story 1 only
- This delivers the core architectural correction: launcher-managed isolated OpenSandbox runtimes become the default path for managed local OpenCode agents

---

## Notes

- All tasks follow the required checklist format with IDs, optional [P] markers, story labels where required, and exact file paths
- Tests are included as verification tasks because the feature’s acceptance depends on proving provisioning, restart, teardown, migration, and remote ACP behavior
- Avoid expanding scope into unrelated runtime families, Kubernetes orchestration, or Pi-as-remote-harness implementation in phase 1
