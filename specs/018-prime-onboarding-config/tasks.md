# Tasks: Prime Onboarding Configuration

**Input**: Design documents from `/specs/018-prime-onboarding-config/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Test tasks are included because `quickstart.md` defines verification focus for backend route behavior, Prime preference translation, wizard validation, plugin selection, launch, and team confirmation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4, US5)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure) ✅ COMPLETE

**Purpose**: Prepare shared type and contract scaffolding without changing behavior.

- [x] T001 Add onboarding DTO types for provider readiness, function assignments, plugin choices, launch readiness, and team plans in `web/src/types.ts`
- [x] T002 [P] Add backend onboarding DTO/type definitions for setup drafts, launch validation, plugin choices, and team plans in `backend/src/routes/setup.ts`
- [x] T003 [P] Add API client method stubs for setup draft, launch validation, plugins, and team confirmation in `web/src/api.ts`
- [x] T004 [P] Add shared Prime onboarding function key constants for orchestration, planning, coding/execution, review/validation, and platform maintenance in `backend/src/prime-agent/config.ts`

---

## Phase 2: Foundational (Blocking Prerequisites) ✅ COMPLETE

**Purpose**: Core persistence, validation, and API foundation that MUST be complete before any user story can be implemented.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T005 Add idempotent onboarding progress, plugin choice, and team plan storage columns or tables in `backend/src/db.ts`
- [x] T006 Implement setup draft load/save helpers that never persist raw provider secrets in `backend/src/routes/setup.ts`
- [x] T007 Implement default Prime function assignment factory and assignment validation helpers in `backend/src/prime-agent/config.ts`
- [x] T008 Implement conversion from onboarding function assignments to Prime `model_preferences` in `backend/src/prime-agent/config.ts`
- [x] T009 Implement launch readiness validation for required Prime functions, assignment reuse, and model capability warnings in `backend/src/routes/setup.ts`
- [x] T010 [P] Implement masked provider credential/readiness response mapping for setup drafts in `backend/src/registry.ts`
- [x] T011 [P] Add backend test fixtures for providers, setup drafts, Prime function assignments, plugin choices, and team plans in `backend/tests/setup.route.test.ts` (mock fix for resolveModelRoutes)
- [x] T012 [P] Add frontend fixture builders for onboarding providers, assignments, plugins, launch readiness, and team plans in `web/tests/fixtures/onboarding.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin.

---

## Phase 3: User Story 1 - Connect model providers during onboarding (Priority: P1) 🎯 MVP

**Goal**: A new user can connect cloud and local model providers, verify readiness, and continue onboarding without exposing stored credentials.

**Independent Test**: Start onboarding from an unconfigured state, add a cloud provider and a local provider, validate their availability, and confirm the user can continue without leaving onboarding.

### Tests for User Story 1

- [x] T013 [P] [US1] Add backend route tests for cloud/local provider draft persistence, masked credential state, and readiness responses in `backend/tests/setup.route.test.ts`
- [x] T014 [P] [US1] Add backend route tests for model discovery success, provider rejection, and unreachable local provider recovery in `backend/tests/providers.route.test.ts`
- [x] T015 [P] [US1] Add frontend tests for provider setup loading, verified, failed, skipped, masked credential, and retry states in `web/tests/pages/Setup.providers.test.tsx`

### Implementation for User Story 1

- [x] T016 [US1] Extend `GET /api/setup/status`, `GET /api/setup/draft`, and `PUT /api/setup/draft` provider behavior in `backend/src/routes/setup.ts`
- [x] T017 [US1] Extend provider create/update paths to support onboarding readiness without returning raw API keys in `backend/src/routes/providers.ts`
  - Provider create/update paths already mask API keys via `encrypt()` and return `'••••••••'` in responses
  - Verified: backend route tests confirm `api_key` is never exposed in plaintext
- [x] T018 [US1] Update provider registry persistence to expose `masked_credential_state` and `connection_status` in `backend/src/registry.ts`
- [x] T019 [US1] Update setup API client methods for provider draft save, readiness, and model discovery errors in `web/src/api.ts`
  - `fetchSetupStatus()`, `fetchSetupDraft()`, `saveSetupDraft()`, `validateLaunch()` implemented
  - `fetchSetupProviderModels()` available for model discovery
- [x] T020 [US1] Rework the Providers step to show cloud/local setup, readiness badges, masked credentials, retry/edit/skip paths, and manual model fallback in `web/src/pages/Setup.tsx`
- [x] T021 [US1] Update setup progress scoring for provider readiness and local-only/cloud-only continuation in `web/src/pages/Setup.tsx`
- [x] T022 [US1] Add provider setup error, empty, loading, and success copy aligned to the UI contract in `web/src/pages/Setup.tsx`

**Checkpoint**: User Story 1 should be fully functional and testable independently.

---

## Phase 4: User Story 2 - Assign providers and models to Prime functions (Priority: P2)

**Goal**: A user can assign provider/model choices to every required Prime function, including default functions, with warnings and launch-blocking validation.

**Independent Test**: Connect multiple providers, assign distinct or reused provider/model combinations to each Prime function, and confirm the configuration summary clearly reflects all assignments.

### Tests for User Story 2

- [X] T023 [P] [US2] Add backend tests for required Prime function validation, assignment reuse, blocked models, and warning models in `backend/tests/setup.route.test.ts`
- [X] T024 [P] [US2] Add backend tests for `model_preferences` translation from onboarding assignments in `backend/tests/prime-agent-config.test.ts`
- [X] T025 [P] [US2] Add frontend tests for the Prime function assignment matrix, model capability warnings, blocking errors, and assignment reuse in `web/tests/pages/Setup.assignments.test.tsx`

### Implementation for User Story 2

- [X] T026 [US2] Add `POST /api/setup/validate-launch` assignment validation response in `backend/src/routes/setup.ts`
- [X] T027 [US2] Persist function assignments in setup draft state and finalized Prime config in `backend/src/routes/setup.ts`
- [X] T028 [US2] Wire model capability assessment into setup assignment validation using `backend/src/prime-agent/model-capability.ts`
- [X] T029 [US2] Update Prime config route or config helper behavior to read the new default function keys in `backend/src/prime-agent/config.ts`
- [X] T030 [US2] Add frontend API calls for validate-launch and assignment draft persistence in `web/src/api.ts`
- [X] T031 [US2] Implement the Prime function assignment matrix with provider/model selectors in `web/src/pages/Setup.tsx`
- [X] T032 [US2] Implement assignment warnings, blocked states, reuse indicators, and required-function missing states in `web/src/pages/Setup.tsx`
- [X] T033 [US2] Update Setup launch gating to require valid assignments for orchestration, planning, coding/execution, review/validation, and platform maintenance in `web/src/pages/Setup.tsx`

**Checkpoint**: User Stories 1 and 2 should both work independently.

---

## Phase 5: User Story 3 - Review and adjust default Prime configuration (Priority: P3)

**Goal**: A user sees the default Prime Agent configuration after assignments, can adjust supported fields, and gets a clear launch summary.

**Independent Test**: Proceed from model assignment to configuration review, make one adjustment, and confirm final launch uses the adjusted configuration.

### Tests for User Story 3

- [x] T034 [P] [US3] Add backend tests for Prime config draft validation, default acceptance, invalid values, and finalized config persistence in `backend/tests/setup.route.test.ts`
- [X] T035 [P] [US3] Add frontend tests for Prime config review defaults, edits, invalid fields, and launch summary updates in `web/tests/pages/Setup.prime-config.test.tsx`

### Implementation for User Story 3

- [x] T036 [US3] Extend setup draft and complete payload handling for editable Prime config values in `backend/src/routes/setup.ts`
- [X] T037 [US3] Validate cron, debounce, cost control, and workspace-related Prime config fields before launch in `backend/src/routes/setup.ts`
- [x] T038 [US3] Update Prime config persistence for reviewed defaults and user adjustments in `backend/src/prime-agent/config.ts`
- [X] T039 [US3] Add frontend API types and client handling for Prime config draft validation errors in `web/src/api.ts`
  - Added `monthly_token_budget` field to `PrimeConfigDraft` interface
  - Updated `/validate-launch` backend endpoint to validate prime config fields and return errors in `blocking_reasons`
- [X] T040 [US3] Add Prime Configuration Review step with editable defaults, function assignment summary, provider readiness summary, and blocking errors in `web/src/pages/Setup.tsx`
  - Already implemented: StepPrimeConfigReview component at line 1787 with cron/debounce/budget fields, validation, workspace config, and assignment summary
- [X] T041 [US3] Update Launch step summary to show reviewed Prime config values and assignment readiness in `web/src/pages/Setup.tsx`
  - Already implemented: StepLaunch references primeConfigDraft with validation at line 2041

**Checkpoint**: User Stories 1, 2, and 3 should work independently.

---

## Phase 6: User Story 4 - Choose optional plugins during onboarding (Priority: P4)

**Goal**: A user can select or skip optional pi plugins during onboarding, with detailed plugin configuration deferred until after Prime is running.

**Independent Test**: Open the plugin step, select or skip available plugins, and confirm the resulting configuration records the choice without preventing Prime launch.

### Tests for User Story 4

- [x] T042 [P] [US4] Add backend tests for plugin inventory, selected plugin persistence, empty inventory, and non-blocking validation in `backend/tests/setup.route.test.ts`
- [x] T043 [P] [US4] Add frontend tests for plugin available, empty, unavailable, selected, skipped, and post-launch configuration states in `web/tests/pages/Setup.plugins.test.tsx`

### Implementation for User Story 4

- [x] T044 [US4] Implement `GET /api/setup/plugins` with available pi plugin metadata and unavailable placeholder response in `backend/src/routes/setup.ts`
- [x] T045 [US4] Persist selected plugin choices and deferred post-launch configuration state in setup draft handling in `backend/src/routes/setup.ts`
- [X] T046 [US4] Add plugin inventory and selection API client methods in `web/src/api.ts`
  - Added `PluginInfo` type with `{ id, name, description, optional, status }`
  - Simplified `PluginChoice` type to `{ plugin_id, selected }`
  - Updated `fetchSetupPlugins()` to return `PluginInfo[]`
- [x] T047 [US4] Add Optional Plugins step with select/skip controls and post-launch configuration messaging in `web/src/pages/Setup.tsx`
- [x] T048 [US4] Include selected or skipped plugin state in the Prime configuration review and launch summary in `web/src/pages/Setup.tsx`

**Checkpoint**: User Stories 1 through 4 should work independently.

---

## Phase 7: User Story 5 - Launch Prime and complete setup conversationally (Priority: P5)

**Goal**: Launch Prime with the finalized configuration, start the setup conversation, propose a team plan, strongly recommend SRE and DevOps, and create agents only after user confirmation.

**Independent Test**: Complete onboarding, launch Prime, answer Prime setup questions, confirm SRE/DevOps recommendations, and verify agents are created only after the user approves the team plan.

### Tests for User Story 5

- [x] T049 [P] [US5] Add backend tests for setup completion, Prime launch thread creation, launch failure recovery, and preserved configuration in `backend/tests/setup.route.test.ts`
- [X] T050 [P] [US5] Add backend tests for team plan proposal, SRE/DevOps strong recommendations, optional agents, confirmation, and retry on creation failure in `backend/tests/prime-agent-team-plan.test.ts`
- [X] T051 [P] [US5] Add frontend tests for launch state, Prime conversation handoff, team plan confirmation, partial confirmation, and creation failure states in `web/tests/pages/Setup.launch-team.test.tsx`

### Implementation for User Story 5

- [x] T052 [US5] Extend setup completion to snapshot finalized assignments, plugins, Prime config, and launch readiness in `backend/src/routes/setup.ts`
- [x] T053 [US5] Update Prime launch behavior to create or reuse an onboarding thread with configuration context in `backend/src/routes/setup.ts`
- [x] T054 [US5] Add team plan data model persistence and confirmation status handling in `backend/src/db.ts`
- [x] T055 [US5] Implement Prime team plan generation helper with strongly recommended SRE and DevOps platform maintenance agents in `backend/src/prime-agent/service.ts`
- [x] T056 [US5] Implement `POST /api/setup/team-plan/:id/confirm` to create only confirmed agents and preserve failed plans for retry in `backend/src/routes/setup.ts`
  - Added `GET /api/setup/team-plan/:id` endpoint
  - Added `POST /api/setup/team-plan/:id/confirm` endpoint with validation, agent creation, and confirmation status tracking
- [x] T057 [US5] Route confirmed agent creation through existing agent creation/registry behavior without modeling Prime as an agents table row in `backend/src/routes/agents.ts`
- [x] T058 [US5] Add frontend API methods for launch result, team plan fetch/confirm, and creation failure handling in `web/src/api.ts`
- [x] T059 [US5] Add Prime setup conversation handoff, team plan display, SRE/DevOps strong recommendation UI, optional agent selection, and confirmation controls in `web/src/pages/Setup.tsx`
- [x] T060 [US5] Add links or visibility for created confirmed agents after team creation in `web/src/pages/Agents.tsx`

**Checkpoint**: All user stories should now be independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories.

- [x] T061 [P] Review onboarding API contract coverage and update `specs/018-prime-onboarding-config/contracts/onboarding-api.md` if implementation intentionally differs
- [x] T062 [P] Review onboarding UI contract coverage and update `specs/018-prime-onboarding-config/contracts/onboarding-ui.md` if implementation intentionally differs
- [x] T063 Add operational logging for provider verification, setup validation, Prime launch, plugin inventory, and team confirmation failures in `backend/src/routes/setup.ts`
- [x] T064 Review accessibility, keyboard navigation, status text, and visual consistency for the full wizard in `web/src/pages/Setup.tsx`
- [x] T065 Run quickstart acceptance walkthroughs and record results in `specs/018-prime-onboarding-config/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1 completion - BLOCKS all user stories.
- **User Stories (Phase 3+)**: Depend on Phase 2 completion.
- **Polish (Phase 8)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational; MVP provider setup and readiness.
- **User Story 2 (P2)**: Starts after Foundational and benefits from US1 provider readiness, but assignment validation can be developed against fixtures.
- **User Story 3 (P3)**: Starts after US2 assignment shape is stable; independently testable with fixtures.
- **User Story 4 (P4)**: Starts after Foundational; independent of US2/US3 except final summary integration.
- **User Story 5 (P5)**: Starts after US2, US3, and US4 finalize launch payload shape.

### Within Each User Story

- Test tasks should be written before implementation tasks where practical.
- Backend validation/persistence should land before frontend launch gating for the same story.
- Frontend API methods should land before UI components that consume them.
- A story is complete only after recoverable error states and user-visible summaries are implemented.

## Parallel Opportunities

- T002, T003, and T004 can run in parallel after T001 starts because they touch different files.
- T010, T011, and T012 can run in parallel with T006-T009 after schema direction is known.
- Test files for each story can be written in parallel with backend/frontend implementation in separate files.
- US4 plugin work can proceed in parallel with US2/US3 after Foundational because plugin selection is non-blocking.
- Polish contract review tasks T061 and T062 can run in parallel.

## Parallel Example: User Story 1

```bash
Task: "Add backend route tests for cloud/local provider draft persistence, masked credential state, and readiness responses in backend/tests/setup.route.test.ts"
Task: "Add backend route tests for model discovery success, provider rejection, and unreachable local provider recovery in backend/tests/providers.route.test.ts"
Task: "Add frontend tests for provider setup loading, verified, failed, skipped, masked credential, and retry states in web/tests/pages/Setup.providers.test.tsx"
```

## Parallel Example: User Story 4

```bash
Task: "Add backend tests for plugin inventory, selected plugin persistence, empty inventory, and non-blocking validation in backend/tests/setup.route.test.ts"
Task: "Add frontend tests for plugin available, empty, unavailable, selected, skipped, and post-launch configuration states in web/tests/pages/Setup.plugins.test.tsx"
Task: "Add plugin inventory and selection API client methods in web/src/api.ts"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1.
4. Validate provider setup independently using backend route tests and Setup provider UI tests.
5. Demo local-only and cloud-provider recovery flows before continuing.

### Incremental Delivery

1. Complete Setup + Foundational → durable draft, default assignments, validation helpers ready.
2. Add User Story 1 → provider connection and readiness MVP.
3. Add User Story 2 → Prime function assignment matrix and launch blocking.
4. Add User Story 3 → Prime configuration review and final summary.
5. Add User Story 4 → optional plugin selection/skip.
6. Add User Story 5 → Prime launch, setup conversation, and confirmed team creation.
7. Finish Polish → observability, accessibility, contract updates, quickstart validation.

### Team Parallel Strategy

1. Backend agent: T005-T011, then route/config tasks for US1-US5.
2. Frontend agent: T001/T003/T012, then Setup wizard UI tasks after API shapes are stable.
3. Test agent: T013-T015, T023-T025, T034-T035, T042-T043, T049-T051 using contracts as source of truth.
4. Review agent: T061-T065 after implementation stabilizes.
