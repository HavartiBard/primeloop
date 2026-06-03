# Tasks: PrimeLoop Repo Rename Plan

**Input**: Design documents from `/specs/023-repo-rename-plan/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: No new automated test tasks are required by the specification. Verification is performed through repository inventory checks, manual review, and quickstart validation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Web app monorepo: `backend/`, `web/`, root docs/scripts, and `specs/` planning artifacts

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the planning workspace and baseline inventory inputs for the rename

- [X] T001 Review rename requirements and naming contract in specs/023-repo-rename-plan/spec.md and specs/023-repo-rename-plan/contracts/naming-contract.md
- [X] T002 Capture the current legacy-name inventory baseline with repository search guidance in specs/023-repo-rename-plan/quickstart.md
- [X] T003 [P] Record the initial repository-controlled rename surface list in specs/023-repo-rename-plan/plan.md, validating against research.md Decision 6 and confirming no high-impact references are uncategorized

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define the shared rename inventory, phase boundaries, and migration policy before user-story execution

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Build the categorized rename surface inventory in specs/023-repo-rename-plan/plan.md using the Rename Surface model from specs/023-repo-rename-plan/data-model.md
- [X] T005 [P] Define canonical naming targets for public brand, repo slug, package/image names, and internal Prime terminology in specs/023-repo-rename-plan/plan.md
- [X] T006 [P] Mark preserved historical/archive references and manual external follow-ups in specs/023-repo-rename-plan/plan.md
- [X] T007 Define the staged migration rule for deferred operational identifiers in specs/023-repo-rename-plan/plan.md
- [X] T008 Define phase-level verification and rollback-sensitive notes for the rename in specs/023-repo-rename-plan/plan.md
- [X] T009 Verify the foundational plan stays within repo-rename scope and does not introduce unrelated refactors in specs/023-repo-rename-plan/plan.md

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Identify every public rename surface (Priority: P1) 🎯 MVP

**Goal**: Produce a complete, categorized inventory of repository-controlled rename surfaces and explicitly separate manual external follow-ups

**Independent Test**: Review the plan and confirm it lists repository identity, runtime configuration, docs, packaging, deployment references, product copy, preserved history, and operator-managed external surfaces without requiring further discovery work

### Implementation for User Story 1

- [X] T010 [P] [US1] Inventory root repository metadata surfaces in README.md, AGENTS.md, and package-lock.json (noting root package.json has no renameable name field)
- [X] T011 [P] [US1] Inventory backend operational and manifest surfaces in backend/package.json, backend/package-lock.json, backend/src/, and backend/tests/
- [X] T012 [P] [US1] Inventory frontend branding and copy surfaces in web/package.json, web/package-lock.json, web/index.html, web/src/, and web/tests/
- [X] T013 [P] [US1] Inventory deployment and script surfaces in docker-compose.prod.yml and scripts/dev-up.sh
- [X] T014 [US1] Consolidate the discovered inventory into categorized rename surface tables in specs/023-repo-rename-plan/plan.md
- [X] T014a [P] [US1] Inventory Docker network references in docker-compose.*.yml files and add to rename surface table
- [X] T015 [US1] Add explicit preserved-history and external-follow-up sections to specs/023-repo-rename-plan/plan.md using the rules from specs/023-repo-rename-plan/research.md

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Sequence the rename safely (Priority: P1)

**Goal**: Turn the inventory into an execution-ready staged rename sequence with clear dependencies and completion signals

**Independent Test**: Follow the phase breakdown in the plan and confirm each phase has target surfaces, dependency ordering, compatibility expectations, and a concrete completion check

### Implementation for User Story 2

- [X] T016 [US2] Define Phase A immediate PrimeLoop branding work in specs/023-repo-rename-plan/plan.md
- [X] T017 [US2] Define Phase B active-doc and current-facing cleanup work in specs/023-repo-rename-plan/plan.md
- [X] T018 [US2] Define Phase C operational identifier migration work for package, image, network, and script surfaces in specs/023-repo-rename-plan/plan.md
- [X] T019 [US2] Define Phase D manual external follow-ups only (no final verification) in specs/023-repo-rename-plan/plan.md
- [X] T020 [P] [US2] Map each rename phase to the Naming Target and Rename Phase entities in specs/023-repo-rename-plan/data-model.md and specs/023-repo-rename-plan/plan.md
- [X] T021 [US2] Update specs/023-repo-rename-plan/quickstart.md so the execution flow matches the final phase sequence in specs/023-repo-rename-plan/plan.md

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Preserve operator continuity during the rename (Priority: P2)

**Goal**: Document compatibility risks, staged legacy identifiers, and operator-managed follow-ups so the rename does not silently break workflows

**Independent Test**: Review the plan and confirm every risky rename surface either has an immediate migration step, a staged-legacy rationale, or a manual follow-up entry

### Implementation for User Story 3

- [X] T022 [P] [US3] Document staged-legacy operational identifiers and their rationale in specs/023-repo-rename-plan/plan.md
- [X] T023 [P] [US3] Document repo-slug, package, image, network, and script compatibility risks in specs/023-repo-rename-plan/plan.md
- [X] T024 [P] [US3] Create the manual external follow-up checklist in specs/023-repo-rename-plan/quickstart.md
- [X] T025 [US3] Add operator continuity notes for local clones, bookmarks, CI variables, registry references, and deployment assumptions in specs/023-repo-rename-plan/plan.md
- [X] T026 [US3] Verify preserved historical references versus active references are unambiguous in specs/023-repo-rename-plan/plan.md and specs/023-repo-rename-plan/quickstart.md

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final consistency pass across the rename plan artifacts

- [X] T027 [P] Normalize PrimeLoop/Prime terminology across specs/023-repo-rename-plan/spec.md, specs/023-repo-rename-plan/plan.md, specs/023-repo-rename-plan/research.md, specs/023-repo-rename-plan/data-model.md, specs/023-repo-rename-plan/contracts/naming-contract.md, and specs/023-repo-rename-plan/quickstart.md
- [X] T028 [P] Review task, plan, and quickstart wording for explicit exclusions around historical preservation and third-party runbooks in specs/023-repo-rename-plan/
- [X] T029 Run the quickstart validation workflow in specs/023-repo-rename-plan/quickstart.md and record any required plan adjustments in specs/023-repo-rename-plan/plan.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - **US1** and **US2** are both P1, but US2 depends on the inventory produced in US1
  - **US3** depends on the phase model defined in US2
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - establishes the rename inventory baseline
- **User Story 2 (P1)**: Depends on User Story 1 inventory consolidation
- **User Story 3 (P2)**: Depends on User Story 2 phase sequencing and uses inventory/risk data from US1

### Within Each User Story

- Inventory discovery before consolidation
- Consolidation before phase sequencing
- Phase sequencing before compatibility and external follow-up guidance
- Cross-document terminology and validation after all story work

### Parallel Opportunities

- Setup task T003 can run in parallel with early inventory review once requirements are understood
- Foundational tasks T005 and T006 can run in parallel
- US1 discovery tasks T010-T013 can run in parallel across separate repo areas
- US2 task T020 can run in parallel with phase drafting once phase boundaries are known
- US3 tasks T022-T024 can run in parallel across plan and quickstart documents
- Polish tasks T027 and T028 can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch repository-surface inventory tasks together:
Task: "Inventory root repository metadata surfaces in README.md, AGENTS.md, package.json, and package-lock.json"
Task: "Inventory backend operational and manifest surfaces in backend/package.json, backend/package-lock.json, backend/src/, and backend/tests/"
Task: "Inventory frontend branding and copy surfaces in web/package.json, web/package-lock.json, web/index.html, web/src/, and web/tests/"
Task: "Inventory deployment and script surfaces in docker-compose.prod.yml and scripts/dev-up.sh"
```

---

## Parallel Example: User Story 3

```bash
# Launch compatibility documentation tasks together:
Task: "Document staged-legacy operational identifiers and their rationale in specs/023-repo-rename-plan/plan.md"
Task: "Document repo-slug, package, image, network, and script compatibility risks in specs/023-repo-rename-plan/plan.md"
Task: "Create the manual external follow-up checklist in specs/023-repo-rename-plan/quickstart.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Confirm the rename inventory is complete and categorized
5. Use that inventory as the base for later sequencing work

### Incremental Delivery

1. Complete Setup + Foundational → Rename policy and inventory framework ready
2. Add User Story 1 → Validate complete rename-surface inventory
3. Add User Story 2 → Validate execution-ready staged phase sequence
4. Add User Story 3 → Validate compatibility and external follow-up guidance
5. Finish with polish and quickstart validation

### Parallel Team Strategy

With multiple contributors:

1. One contributor finalizes foundational naming/phase policy
2. Once Phase 2 is done:
   - Contributor A: root/docs inventory
   - Contributor B: backend/deployment inventory
   - Contributor C: frontend/product-copy inventory
3. After US1 consolidation:
   - Contributor A: phase sequencing in plan.md
   - Contributor B: compatibility/manual follow-up guidance in quickstart.md
   - Contributor C: terminology and preservation consistency across artifacts

---

## Notes

- [P] tasks = different files or separable document sections with no blocking dependency
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and reviewable as a planning increment
- The specification did not request TDD or automated test-first work; verification tasks are documentation and repository-audit focused
- Avoid unrelated code refactors while executing the rename plan
