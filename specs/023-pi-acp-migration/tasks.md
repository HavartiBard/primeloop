# Tasks: Pi ACP Migration

**Input**: Design documents from `/specs/023-pi-acp-migration/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Backend test updates are required for this feature because the spec and plan require verification of Pi routing, lifecycle preservation, and startup failure behavior.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Backend code: `backend/src/`
- Backend tests: `backend/tests/`
- Feature docs: `specs/023-pi-acp-migration/`

## Phase 1: Setup (Shared Infrastructure) ✅ COMPLETE

**Purpose**: Prepare the repository for the Pi ACP migration work

- [X] T001 Add the `pi-acp` runtime dependency in `backend/package.json`
- [X] T002 Review and update feature implementation notes in `specs/023-pi-acp-migration/quickstart.md` if dependency or verification wording changes during implementation

---

## Phase 2: Foundational (Blocking Prerequisites) ✅ COMPLETE

**Purpose**: Establish the shared Pi ACP launch contract and remove direct PiHarness dependencies that block all stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Define the built-in Pi ACP launch profile and Pi runtime-family routing entry point in `backend/src/opencode/process-manager.ts`
- [X] T004 [P] Remove `PiHarness` imports and any direct PiHarness-specific startup references from `backend/src/opencode/process-manager.ts`
- [X] T005 [P] Delete the obsolete Pi harness implementation file `backend/src/fleet-executor/pi-harness.ts`
- [X] T006 [P] Delete or replace the retired direct harness test coverage in `backend/tests/fleet-executor/pi-harness.test.ts`

**Checkpoint**: Foundation ready - Pi runtime startup is centralized on the ACP path

---

## Phase 3: User Story 1 - Run existing Pi agents without a bespoke bridge (Priority: P1) 🎯 MVP

**Goal**: Route existing Pi agents through `AcpHarness` with the built-in `pi-acp` command while preserving normal task lifecycle behavior

**Independent Test**: Start a pre-existing Pi agent through the process manager and confirm it launches through the ACP path, streams task progress, supports cancellation, and reaches a terminal state without using `PiHarness`

### Tests for User Story 1

- [ ] T007 [P] [US1] Add Pi ACP routing coverage in `backend/tests/opencode/process-manager.test.ts`
- [ ] T008 [P] [US1] Add Pi lifecycle and cancellation regression coverage through the ACP path in `backend/tests/opencode/process-manager.test.ts`

### Implementation for User Story 1

- [ ] T009 [US1] Implement Pi runtime-family startup through `AcpHarness` in `backend/src/opencode/process-manager.ts`
- [ ] T010 [US1] Ensure the Pi ACP launch profile uses the built-in `pi-acp` command and correct workspace/worktree inputs in `backend/src/opencode/process-manager.ts`
- [ ] T011 [US1] Preserve downstream harness registration and cleanup behavior for Pi runs in `backend/src/opencode/process-manager.ts`

**Checkpoint**: User Story 1 is fully functional and Pi agents run through ACP instead of the bespoke bridge

---

## Phase 4: User Story 2 - Keep Pi model and provider selection intact (Priority: P1)

**Goal**: Preserve resolved model/provider environment passthrough for Pi runs after the migration

**Independent Test**: Configure a Pi agent with a known model/provider selection and confirm the spawned Pi ACP process receives the expected resolved runtime environment values

### Tests for User Story 2

- [ ] T012 [P] [US2] Add model/provider passthrough assertions for Pi ACP startup in `backend/tests/opencode/process-manager.test.ts`
- [ ] T013 [P] [US2] Add Pi ACP startup failure coverage for missing `pi-acp` or underlying `pi` runtime in `backend/tests/opencode/process-manager.test.ts`

### Implementation for User Story 2

- [ ] T014 [US2] Preserve resolved `PI_MODEL` and `PI_PROVIDER` environment passthrough on the Pi ACP launch path in `backend/src/opencode/process-manager.ts`
- [ ] T015 [US2] Ensure Pi startup surfaces actionable ACP launch failures through existing error handling in `backend/src/opencode/process-manager.ts`

**Checkpoint**: Pi ACP runs keep the same model/provider configuration behavior and actionable startup failures

---

## Phase 5: User Story 3 - Avoid disruptive registry migration (Priority: P2)

**Goal**: Keep existing Pi registry rows working with no mandatory database or per-agent configuration migration

**Independent Test**: Use an existing Pi agent record with no schema changes and confirm the process manager automatically selects the built-in Pi ACP launch profile while ignoring legacy per-agent command overrides

### Tests for User Story 3

- [ ] T016 [P] [US3] Add existing Pi registry row compatibility coverage in `backend/tests/opencode/process-manager.test.ts`
- [ ] T017 [P] [US3] Add ignored per-agent command/argument override coverage for Pi agents in `backend/tests/opencode/process-manager.test.ts`

### Implementation for User Story 3

- [ ] T018 [US3] Keep `runtime_family = 'pi'` mapped transparently to the built-in Pi ACP launch profile in `backend/src/opencode/process-manager.ts`
- [ ] T019 [US3] Ignore per-agent subprocess command and argument overrides for Pi agents while preserving generic ACP behavior in `backend/src/opencode/process-manager.ts`

**Checkpoint**: Existing Pi agent records remain valid without migration and Pi startup is deterministic across agents

---

## Phase 6: User Story 4 - Remove the obsolete Pi-specific runtime bridge safely (Priority: P3)

**Goal**: Complete the migration by removing the obsolete Pi-specific bridge and its remaining references

**Independent Test**: Confirm no runtime startup path depends on `PiHarness` and Pi agents still run successfully through the ACP path

### Tests for User Story 4

- [ ] T020 [P] [US4] Remove or replace any remaining direct PiHarness expectations in `backend/tests/opencode/process-manager.test.ts`
- [ ] T021 [P] [US4] Add regression coverage proving Pi runtime selection uses ACP while generic ACP agents keep configurable command behavior in `backend/tests/opencode/process-manager.test.ts`

### Implementation for User Story 4

- [ ] T022 [US4] Remove any remaining PiHarness references from backend runtime code in `backend/src/opencode/process-manager.ts`
- [ ] T023 [US4] Update ACP harness-facing runtime expectations, imports, or comments affected by the removal in `backend/src/fleet-executor/acp-harness.ts`

**Checkpoint**: The obsolete Pi-specific bridge is fully removed and Pi has one supported subprocess protocol path

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final cleanup, documentation alignment, and requested verification

- [ ] T024 [P] Update migration documentation and implementation notes in `specs/023-pi-acp-migration/research.md`, `specs/023-pi-acp-migration/data-model.md`, and `specs/023-pi-acp-migration/contracts/pi-runtime-launch.md` if the delivered code differs from planned wording
- [ ] T025 Run the requested backend verification for the touched runtime path in `backend/tests/opencode/process-manager.test.ts` and record the result in `specs/023-pi-acp-migration/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phases 3-6)**: Depend on Foundational completion
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational; establishes the ACP runtime path for Pi
- **User Story 2 (P1)**: Depends on User Story 1 launch path being in place
- **User Story 3 (P2)**: Depends on User Story 1 launch path; verifies compatibility and override handling
- **User Story 4 (P3)**: Depends on User Stories 1-3 being complete so deletion happens after replacement coverage exists

### Within Each User Story

- Test updates should be added before or alongside implementation and must fail before the final fix is complete
- Runtime routing changes precede cleanup of obsolete references
- Verification runs after implementation and test updates are complete

### Parallel Opportunities

- T004-T006 can run in parallel after T003
- T007-T008 can run in parallel
- T012-T013 can run in parallel
- T016-T017 can run in parallel
- T020-T021 can run in parallel
- T024 can run in parallel with final code cleanup once implementation stabilizes

---

## Parallel Example: User Story 1

```bash
# Launch Pi ACP routing and lifecycle coverage tasks together:
Task: "Add Pi ACP routing coverage in backend/tests/opencode/process-manager.test.ts"
Task: "Add Pi lifecycle and cancellation regression coverage through the ACP path in backend/tests/opencode/process-manager.test.ts"
```

## Parallel Example: User Story 3

```bash
# Launch compatibility-focused Pi registry tests together:
Task: "Add existing Pi registry row compatibility coverage in backend/tests/opencode/process-manager.test.ts"
Task: "Add ignored per-agent command/argument override coverage for Pi agents in backend/tests/opencode/process-manager.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Validate that Pi agents now run through ACP with no PiHarness dependency

### Incremental Delivery

1. Finish Setup + Foundational to establish the single Pi ACP path
2. Deliver User Story 1 to prove the runtime migration works
3. Deliver User Story 2 to preserve runtime configuration behavior
4. Deliver User Story 3 to prove compatibility without migration
5. Deliver User Story 4 to finish removal and cleanup
6. Run final verification and documentation alignment

### Parallel Team Strategy

1. One developer updates dependency and runtime mapping
2. One developer prepares process-manager regression coverage
3. One developer handles final cleanup/documentation after routing behavior is stable

---

## Notes

- [P] tasks = different files or independent test additions that can proceed in parallel
- [Story] labels map tasks to user stories for traceability
- Exact runtime behavior for Pi agents is defined by `specs/023-pi-acp-migration/contracts/pi-runtime-launch.md`
- Avoid reintroducing Pi-specific harness abstractions or per-agent override support for `pi` runtime-family agents
