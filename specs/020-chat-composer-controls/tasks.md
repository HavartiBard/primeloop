# Tasks: Chat Composer Controls

**Input**: Design documents from `/specs/020-chat-composer-controls/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are OPTIONAL - only included if explicitly requested in the feature specification. This feature does not explicitly require test-first delivery, so no standalone test tasks are generated.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Web app**: `web/src/`, `backend/src/`, `web/tests/`
- Paths below use the ACP repository structure from plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the ACP chat input surface, existing contracts, and target files before implementation

- [X] T001 Confirm the target ACP chat input surface and current composer implementation in `web/src/components/CollaborationRoomsView.tsx`
- [X] T002 Confirm existing message submission payload usage and error handling paths in `web/src/components/CollaborationRoomsView.tsx` and `backend/src/routes|services`
- [X] T003 [P] Confirm available model, mode, and tool policy sources referenced by the ACP chat input in `web/src/components/CollaborationRoomsView.tsx`, `backend/src/runtime.ts`, and `backend/src/portal.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish shared composer state, payload mapping, and validation rules used by all user stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Create shared composer types for `ChatDraft`, `Attachment`, `ToolConfig`, `ModelOption`, and `ExecutionMode` in `web/src/types/composer.ts`
- [X] T005 [P] Add reusable composer validation helpers for input-required, model validity, mode validity, attachment size/type, and tool availability in `web/src/lib/chatComposerValidation.ts`
- [X] T006 [P] Add reusable composer payload mapping helpers for ACP message submission in `web/src/lib/chatComposerPayload.ts`
- [X] T007 Update `web/src/components/CollaborationRoomsView.tsx` to use the shared composer types and helpers as the single ACP chat input composition path
- [X] T008 Preserve existing backend message delivery contract while documenting any frontend-only payload extensions in `specs/020-chat-composer-controls/contracts/composer-api.md`
- [X] T009 Ensure draft-preservation and error-surface behavior is wired through the ACP chat input send flow in `web/src/components/CollaborationRoomsView.tsx`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Send a guided agent request (Priority: P1) 🎯 MVP

**Goal**: The ACP chat input shows the `<prime>...` placeholder, lets the operator choose model and execution mode, and sends a message using those selections

**Independent Test**: Open the ACP chat input, observe the `<prime>...` placeholder on an empty draft, choose a model, toggle planning/agent mode, send a message, and confirm the submitted request carries the selected model and mode

### Implementation for User Story 1

- [X] T010 [US1] Replace the ACP chat input placeholder with `<prime>...` in `web/src/components/CollaborationRoomsView.tsx`
- [X] T011 [US1] Add ACP chat input state for selected model and execution mode in `web/src/components/CollaborationRoomsView.tsx`
- [X] T012 [US1] Render a model selector in the ACP chat input composer in `web/src/components/CollaborationRoomsView.tsx`
- [X] T013 [US1] Render a planning-vs-agent mode toggle in the ACP chat input composer in `web/src/components/CollaborationRoomsView.tsx`
- [X] T014 [US1] Map selected model and execution mode into the outbound ACP message payload in `web/src/components/CollaborationRoomsView.tsx`
- [X] T015 [US1] Show sending, success, and inline error states for ACP chat input submission in `web/src/components/CollaborationRoomsView.tsx`
- [X] T016 [US1] Reset the ACP draft to default placeholder and default control state after successful send in `web/src/components/CollaborationRoomsView.tsx`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Attach supporting inputs to a message (Priority: P2)

**Goal**: The ACP chat input lets the operator add files, images, and a companion prompt and submit them as part of one message

**Independent Test**: Compose a message in the ACP chat input with an uploaded file, an uploaded image, and a companion prompt, send it, and confirm all selected inputs are associated with the submitted request

### Implementation for User Story 2

- [X] T017 [US2] Add ACP chat input attachment picker controls for files and images in `web/src/components/CollaborationRoomsView.tsx`
- [X] T018 [US2] Add ACP chat input state and UI for companion prompt entry in `web/src/components/CollaborationRoomsView.tsx`
- [X] T019 [US2] Implement attachment add, remove, retry, and pending/upload-failed state handling in `web/src/components/CollaborationRoomsView.tsx`
- [X] T020 [US2] Apply attachment size and allowed-type validation using `web/src/lib/chatComposerValidation.ts` in `web/src/components/CollaborationRoomsView.tsx`
- [X] T021 [US2] Allow attachment-only and companion-prompt-only submissions in the ACP chat input send validation path in `web/src/components/CollaborationRoomsView.tsx`
- [X] T022 [US2] Render selected attachments and companion prompt presence before send in `web/src/components/CollaborationRoomsView.tsx`
- [X] T023 [US2] Map attachments and companion prompt into the outbound ACP message payload in `web/src/components/CollaborationRoomsView.tsx`
- [X] T024 [US2] Surface clear upload failure, oversize, and unsupported-file-type errors in `web/src/components/CollaborationRoomsView.tsx`

**Checkpoint**: At this point, User Stories 1 and 2 should both work independently

---

## Phase 5: User Story 3 - Control tool access per message (Priority: P3)

**Goal**: The ACP chat input lets the operator enable or disable web search, shell, and image processing for each submitted message

**Independent Test**: Toggle tool categories in the ACP chat input, send a message, and confirm the submitted request includes only the enabled tools and blocks unavailable combinations with corrective guidance

### Implementation for User Story 3

- [X] T025 [US3] Add ACP chat input toggles for web search, shell, and image processing in `web/src/components/CollaborationRoomsView.tsx`
- [X] T026 [US3] Initialize and manage per-message tool selection state in `web/src/components/CollaborationRoomsView.tsx`
- [X] T027 [US3] Map enabled tool selections into the outbound ACP message payload in `web/src/components/CollaborationRoomsView.tsx`
- [X] T028 [US3] Validate selected tools against current model/mode availability using `web/src/lib/chatComposerValidation.ts` in `web/src/components/CollaborationRoomsView.tsx`
- [X] T029 [US3] Show blocking corrective guidance for unavailable tool combinations in `web/src/components/CollaborationRoomsView.tsx`
- [X] T030 [US3] Restore default tool selections for a new ACP draft after successful send in `web/src/components/CollaborationRoomsView.tsx`

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final consistency, accessibility, and documentation alignment across the ACP chat input feature

- [X] T031 [P] Align contract docs with ACP-only scope and branch naming in `specs/020-chat-composer-controls/contracts/composer-api.md` and `specs/020-chat-composer-controls/contracts/validation.md`
- [X] T032 [P] Align planning/support docs with ACP-only terminology in `specs/020-chat-composer-controls/research.md`, `specs/020-chat-composer-controls/data-model.md`, and `specs/020-chat-composer-controls/quickstart.md`
- [X] T033 Verify keyboard access, labels, and focus behavior for new ACP chat input controls in `web/src/components/CollaborationRoomsView.tsx`
- [X] T034 Verify draft preservation on validation failure and unavailable-model/tool rejection in `web/src/components/CollaborationRoomsView.tsx`
- [X] T035 Verify visual consistency with existing ACP chips, toggles, spacing, and status messaging in `web/src/components/CollaborationRoomsView.tsx`
- [X] T036 Run the quickstart validation scenarios documented in `specs/020-chat-composer-controls/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - blocks all user stories
- **User Stories (Phase 3+)**: All depend on Foundational completion
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational - MVP and no dependency on other stories
- **User Story 2 (P2)**: Starts after Foundational - independent of US1, but builds on shared composer types/helpers
- **User Story 3 (P3)**: Starts after Foundational - independent of US1/US2, but builds on shared composer types/helpers

### Within Each User Story

- Shared types/helpers before story-specific UI wiring
- State handling before payload mapping and validation
- Validation and error behavior before story completion
- Each story must remain independently testable in the ACP chat input

### Parallel Opportunities

- Phase 1 task T003 can run in parallel with T001-T002
- Phase 2 tasks T005 and T006 can run in parallel after T004
- After Phase 2, US1/US2/US3 can be staffed in parallel if desired
- Polish tasks T031 and T032 can run in parallel

---

## Parallel Example: User Story 1

```bash
# Parallelizable foundational work before US1 wiring:
Task: "Add reusable composer validation helpers in web/src/lib/chatComposerValidation.ts"
Task: "Add reusable composer payload mapping helpers in web/src/lib/chatComposerPayload.ts"

# Parallelizable ACP-only doc cleanup in polish:
Task: "Align contract docs with ACP-only scope in specs/020-chat-composer-controls/contracts/composer-api.md and specs/020-chat-composer-controls/contracts/validation.md"
Task: "Align planning/support docs with ACP-only terminology in specs/020-chat-composer-controls/research.md, specs/020-chat-composer-controls/data-model.md, and specs/020-chat-composer-controls/quickstart.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Stop and validate the ACP chat input MVP flow

### Incremental Delivery

1. Finish Setup + Foundational once
2. Deliver US1 for model/mode + placeholder control
3. Deliver US2 for attachments + companion prompt
4. Deliver US3 for per-message tool control
5. Finish polish and documentation alignment

### Parallel Team Strategy

With multiple developers:

1. One developer completes foundational shared composer helpers
2. Then parallelize:
   - Developer A: US1 model/mode controls
   - Developer B: US2 attachments/prompt
   - Developer C: US3 tool toggles/validation
3. Rejoin for polish and ACP-only doc cleanup

---

## Notes

- [P] tasks = different files, no blocking dependency on incomplete sibling work
- [Story] labels map every implementation task to a specific user story
- Tasks are written for the ACP chat input only
- Odysseus and OpenWeb UI are reference inspirations only and must not be treated as target implementation surfaces
- Avoid adding speculative backend APIs or new persistence unless implementation evidence proves they are required
