# Tasks: Prime Empty Fleet Graceful Degradation

**Input**: Design documents from `/specs/001-prime-empty-fleet-graceful-delegation/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No new infrastructure needed — all changes are to existing files.

- [ ] T001 Read current state of all target files to establish exact edit points
  - `backend/src/prime-agent/llm-router.ts`
  - `backend/src/prime-agent/actions.ts`
  - `backend/prompts/agents/prime.md`
  - `backend/prompts/policies/standing-rules.md`

---

## Phase 2: User Story 1 - Prime responds helpfully when no agents available (Priority: P1) 🎯 MVP

**Goal**: Prime returns a valid decision with a meaningful response and no null-target delegations when fleet is empty.

**Independent Test**: Send a `prime.message` event with empty fleet; verify valid decision returned with response text and no delegate actions targeting null.

### Implementation for User Story 1

- [ ] T002 [US1] Update `buildPrimeSystemPrompt()` in `backend/src/prime-agent/llm-router.ts` to render an explicit empty-fleet message instead of `- none` when `context.fleet.agents.length === 0`
- [ ] T003 [P] [US1] Add runtime guard in `dispatchDelegate()` in `backend/src/prime-agent/actions.ts`: when `selectTargetAgent()` returns undefined, create a pending work item and return a `no_op` result instead of creating an unassigned delegation
- [ ] T004 [P] [US1] Update Prime profile `backend/prompts/agents/prime.md` to include empty-fleet fallback guidance in Default Behaviors section

**Checkpoint**: Prime no longer gets stuck when fleet is empty. It responds conversationally and creates pending work items.

---

## Phase 3: User Story 2 - Track un-delegatable work (Priority: P2)

**Goal**: Work items created from undeliverable tasks are tracked in `pending` status with metadata for later processing.

**Independent Test**: After sending a task with empty fleet, verify a work item exists with `status = 'pending'` and `metadata.action_type = 'pending_delegation'`.

### Implementation for User Story 2

- [ ] T005 [US2] Ensure the pending work item in `dispatchDelegate()` (from T003) includes correct metadata: `{ source: 'prime-agent', action_type: 'pending_delegation', capability, reason, requested_target_id }`
- [ ] T006 [US2] Emit a runtime event for the fallback path with `event_type: 'prime.action.no_op'` and payload containing the reason

**Checkpoint**: Undeliverable tasks are tracked and visible in the work items table.

---

## Phase 4: User Story 3 - Fleet status clearly communicated (Priority: P3)

**Goal**: The system prompt makes the empty-fleet condition unambiguous to the LLM.

**Independent Test**: Inspect generated system prompt; verify agents section contains explicit text about no agents being available.

### Implementation for User Story 3

- [ ] T007 [P] [US3] Update standing rules `backend/prompts/policies/standing-rules.md` to add "no agents available" handling rule
- [ ] T008 [US3] Verify the empty-fleet message in `llm-router.ts` (from T002) is clear and actionable for the LLM

**Checkpoint**: Both the system prompt and standing rules explicitly handle the empty-fleet case.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — read files first
- **User Story 1 (Phase 2)**: Depends on T001 (reading files) — blocks nothing else
- **User Story 2 (Phase 3)**: Depends on T003 (guard implementation) — metadata and event emission build on the guard
- **User Story 3 (Phase 4)**: Partially overlaps with US1 (T002/T007 are independent file edits)

### Parallel Opportunities

- T002, T003, T004 can run in parallel (different files)
- T005, T006 can follow T003 and run in parallel with each other
- T007 is independent of all other tasks (different file)

---

## Notes

- All changes are to existing files — no new files or migrations required
- Each task is scoped to a single file to avoid conflicts
- The MVP (US1) delivers the core fix: Prime stops getting stuck on empty fleet
