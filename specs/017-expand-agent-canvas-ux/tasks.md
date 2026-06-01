# Tasks: Expand Agent Canvas UX

**Input**: Design documents from `/specs/017-expand-agent-canvas-ux/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contract.md, quickstart.md

**Organization**: Tasks are grouped by user story. US1 = live chat activity. US2 = spatial canvas navigation (pan/zoom/layout/persistence). US3 = bottom toolbar + New Goal flow.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: US1, US2, US3
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish shared types, display model, and test scaffolding before story work begins.

- [x] T001 Review existing surfaces: `web/src/components/CollaborationRoomsView.tsx`, `web/src/components/EventFeed.tsx`, `web/src/pages/CircuitView.tsx`, `web/src/api.ts`, `web/src/types.ts`, `web/src/hooks/useCanvasViewport.ts`, `web/src/components/agentCanvas/`
- [x] T002 [P] Create shared display model types for chat events, context attachments, canvas nodes, and toolbar actions in `web/src/types.ts`
- [x] T003 [P] Create reusable status and formatting helpers in `web/src/lib/displayStatus.ts`
- [x] T004 [P] Add test fixture builders for chat display events, canvas nodes, approvals, delegations, and toolbar actions in `web/tests/fixtures/agentCanvasUx.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core reusable components and mapping functions that MUST be complete before any user story can start.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T005 Create chat display event mapper skeleton in `web/src/lib/chatDisplayEvents.ts`
- [x] T006 Create reusable expandable panel state hook in `web/src/hooks/useExpandableItems.ts`
- [x] T007 [P] Create reusable context attachment chip/list component in `web/src/components/agentCanvas/ContextAttachmentList.tsx`
- [x] T008 [P] Create reusable status badge component for all ACP states in `web/src/components/agentCanvas/DisplayStatusBadge.tsx`
- [x] T009 [P] Create shared accessibility helpers for keyboard labels and live-region text in `web/src/lib/accessibilityText.ts`
- [x] T010 Wire exports for new agent canvas UX helpers and components through `web/src/components/agentCanvas/index.ts`
- [x] T011 Add foundational unit tests for status mapping and accessibility text in `web/tests/components/agentCanvasFoundations.test.tsx`

**Checkpoint**: Foundation ready — user story implementation can begin.

---

## Phase 3: User Story 1 — Understand live agent activity in chat (Priority: P1) 🎯 MVP

**Goal**: Operators see distinct thinking, tool call/result, context attachment, approval, and delegation bubbles/cards in active or replayed agent conversations.

**Independent Test**: Open an active or replayed conversation; each event type renders as a distinct, expandable, readable bubble or card without inspecting raw logs.

### Tests for User Story 1

- [x] T012 [P] [US1] Add mapper tests for thinking, tool-call, tool-result, approval, delegation, context attachment, out-of-order, restricted, and unavailable states in `web/tests/lib/chatDisplayEvents.test.ts`
- [x] T013 [P] [US1] Add rendering tests for expanded chat bubbles and cards in `web/tests/components/AgentActivityTimeline.test.tsx`
- [x] T014 [P] [US1] Add integration test covering collaboration room chat timeline rendering in `web/tests/components/CollaborationRoomsView.agentActivity.test.tsx`

### Implementation for User Story 1

- [x] T015 [US1] Implement complete `ChatDisplayEvent` derivation for messages, thinking, tool calls/results, approvals, delegations, goals, artifacts, notes, and system events in `web/src/lib/chatDisplayEvents.ts`
- [x] T016 [P] [US1] Create expandable thinking/tool/message bubble components in `web/src/components/agentCanvas/AgentActivityBubble.tsx`
- [x] T017 [P] [US1] Create approval and delegation display card components in `web/src/components/agentCanvas/DecisionActivityCard.tsx`
- [x] T018 [US1] Create ordered expandable chat timeline component with keyboard navigation and live update states in `web/src/components/agentCanvas/AgentActivityTimeline.tsx`
- [x] T019 [US1] Integrate `AgentActivityTimeline` into active room chat rendering in `web/src/components/CollaborationRoomsView.tsx`
- [x] T020 [US1] Integrate typed bubbles/cards into live event feed while preserving existing empty state in `web/src/components/EventFeed.tsx`
- [x] T021 [US1] Add failure, timeout, restricted-content, unavailable-attachment, and large-result states in `web/src/components/agentCanvas/AgentActivityTimeline.tsx`
- [x] T022 [US1] Verify keyboard access, expand/collapse, chronological ordering, and non-color-only status text in `web/tests/components/AgentActivityTimeline.test.tsx`

**Checkpoint**: User Story 1 is fully functional and independently testable as the MVP.

---

## Phase 4: User Story 2 — Navigate the circuit canvas spatially (Priority: P2)

**Goal**: Operators can click-drag to pan, scroll/pinch to zoom, drag cards to preferred positions (persisted), expand agent/room cards, and see the toolbar inside the canvas viewport without sidebar overlap.

**Independent Test**: Open a circuit with multiple agents and rooms; pan by dragging, zoom by scrolling; drag a card, reload, confirm position is restored; expand cards; confirm toolbar is inside the canvas area.

### Tests for User Story 2

- [x] T023 [P] [US2] Add unit tests for pointer-event pan, scroll-wheel zoom, pinch-to-zoom, and zoom-center in `web/tests/hooks/useCanvasViewport.test.ts`
- [x] T024 [P] [US2] Add unit tests for canvas layout hook: load-on-mount, optimistic update, debounced save, and save-failure fallback in `web/tests/hooks/useCanvasLayout.test.ts`
- [x] T025 [P] [US2] Add interaction tests for pan, zoom, card drag, keyboard selection, card expansion, empty state, toolbar placement, and error state in `web/tests/pages/CircuitView.interactions.test.tsx`

### Implementation for User Story 2

- [X] T026 [US2] Add pointer-event click-drag pan handlers (`onPointerDown`/`onPointerMove`/`onPointerUp` with `setPointerCapture`) to `web/src/hooks/useCanvasViewport.ts`; return handler props from the hook
- [X] T027 [US2] Add scroll-wheel zoom handler (`onWheel` → `zoomBy(delta, cx, cy)`) and two-finger pinch-zoom handlers (`onTouchStart`/`onTouchMove` with hypot distance) to `web/src/hooks/useCanvasViewport.ts`; add `touch-action: none` guidance to hook output
- [X] T028 [US2] Add `canvas_layouts` table migration to `backend/src/db.ts`: `(canvas_key TEXT DEFAULT 'default', card_id TEXT, x FLOAT, y FLOAT, updated_at TIMESTAMPTZ, PRIMARY KEY (canvas_key, card_id))`
- [X] T029 [P] [US2] Create `GET /api/canvas/layout` and `PUT /api/canvas/layout` routes in `backend/src/routes/canvas.ts`; mount under `/api/canvas` in `backend/src/app.ts`
- [X] T030 [P] [US2] Add `fetchCanvasLayout()` and `saveCanvasLayout()` API client functions to `web/src/api.ts`
- [X] T031 [US2] Create `useCanvasLayout` hook (load on mount via react-query, `setPosition(id, x, y)` with 500ms debounced PUT, optimistic update, silent save-failure) in `web/src/hooks/useCanvasLayout.ts`
- [x] T032 [P] [US2] Add backend route tests for canvas layout GET/PUT in `backend/tests/canvas.route.test.ts`
- [ ] T033 [US2] Extract circuit graph enrichment and node detail derivation from `web/src/pages/CircuitView.tsx` into `web/src/lib/circuitViewModel.ts`
- [ ] T034 [P] [US2] Create expandable circuit node card component for all node types in `web/src/components/agentCanvas/CircuitNodeCard.tsx`
- [ ] T035 [P] [US2] Create canvas controls component (zoom in/out, reset, fit) in `web/src/components/agentCanvas/CircuitCanvasControls.tsx`
- [X] T036 [US2] Wire pointer-event handlers, wheel handler, touch handlers, card drag (with `useCanvasLayout.setPosition` on drag-end), and `useCanvasLayout` position loading into `web/src/pages/CircuitView.tsx`; apply `touch-action: none` to the canvas container
- [X] T037 [US2] Mount `BottomActionToolbar` inside the canvas wrapper div as `position: absolute; bottom: 1rem; left: 50%; transform: translateX(-50%); z-index: 10` in `web/src/pages/CircuitView.tsx`
- [x] T038 [US2] Integrate selected and expanded node details for agent and room cards in `web/src/pages/CircuitView.tsx`
- [x] T039 [US2] Add empty, loading, error, crowded, and overflow states for the spatial circuit canvas in `web/src/pages/CircuitView.tsx`
- [x] T040 [US2] Verify pan, zoom, card drag, position restore, toolbar placement, keyboard navigation, and readable labels in `web/tests/pages/CircuitView.interactions.test.tsx`

**Checkpoint**: User Stories 1 and 2 are independently functional. Canvas is pannable, zoomable, drag-repositionable, and toolbar is visible inside viewport.

---

## Phase 5: User Story 3 — New Goal flow and contextual toolbar (Priority: P3)

**Goal**: Operators can create a new Goal from the toolbar (canvas or rooms view), which immediately spawns a Room with Prime; Prime's reasoning streams in the room chat; recruited agents appear on the canvas live. All other toolbar actions (Spawn Agent, Artifact, Note) also work from both contexts.

**Independent Test**: Click "New Goal" from toolbar, fill modal, confirm Room card appears on canvas immediately, Prime's thinking streams in the room thread, and an agent card appears when Prime recruits one. Cancel at any point creates no records.

### Tests for User Story 3

- [ ] T041 [P] [US3] Add backend tests for extended goal creation endpoint (goal + thread in one transaction, prime queue item, thread_id in response) in `backend/tests/control-plane.route.test.ts`
- [ ] T042 [P] [US3] Add component tests for NewGoalModal: submit, cancel, validation, loading, and error states in `web/tests/components/NewGoalModal.test.tsx`
- [ ] T043 [P] [US3] Add toolbar state and cancellation tests in `web/tests/components/BottomActionToolbar.test.tsx`
- [ ] T044 [P] [US3] Add integration tests for toolbar usage from room chat and circuit canvas contexts in `web/tests/components/ContextualToolbar.integration.test.tsx`

### Implementation for User Story 3 — Backend

- [X] T045 [US3] Extend `POST /api/control-plane/goals` in `backend/src/routes/control-plane.ts`: after goal insert, create thread with `metadata: { kind: 'goal-room', goal_id }`, insert opening message, enqueue `prime_queue_items` row `{ type: 'goal_created', goal_id, thread_id }`, return `{ ...goal, thread_id }` — all in one DB transaction; roll back goal on thread creation failure
- [X] T046 [US3] Update `web/src/api.ts` `createGoal()` return type to include `thread_id: string`

### Implementation for User Story 3 — New Goal Modal

- [X] T047 [US3] Create `NewGoalModal` component (title input required ≤200 chars, optional description textarea, Submit/Cancel, loading state, inline error) in `web/src/components/agentCanvas/NewGoalModal.tsx`; export through `web/src/components/agentCanvas/index.ts`
- [X] T048 [US3] Wire "New Goal" toolbar action in `web/src/components/agentCanvas/BottomActionToolbar.tsx` to open `NewGoalModal`; on submit call `createGoal`, navigate to/highlight the new room thread via `thread_id`; on cancel create no records

### Implementation for User Story 3 — Room card on canvas + live agent join

- [X] T049 [US3] After `createGoal` resolves, trigger canvas refetch of threads so the new Room card (thread with `metadata.kind === 'goal-room'`) appears immediately on the circuit canvas in `web/src/pages/CircuitView.tsx`; auto-place at next grid position using `useCanvasLayout`
- [ ] T050 [US3] Listen on existing SSE `/events` stream in `web/src/pages/CircuitView.tsx` for `thread_message` events with `metadata.agent_joined === true`; when received, add agent card to canvas with CSS fade-in transition (`opacity 0→1, 200ms`); no JS animation library
- [ ] T051 [US3] Add Prime queue handler for `goal_created` event type in `backend/src/prime-agent/service.ts`: dequeue the item, post a thinking message to the goal-room thread as Prime evaluates which agents to recruit, post `{ agent_joined: true, agent_id, agent_name }` thread messages as each agent is assigned

### Implementation for User Story 3 — Toolbar in rooms view

- [ ] T052 [US3] Create focused action composer dialog for spawn-agent, tool-call, capture-artifact, and add-note drafts in `web/src/components/agentCanvas/ToolbarActionComposer.tsx`
- [ ] T053 [US3] Implement toolbar draft/submit/success/failure/retry/cancel state management in `web/src/hooks/useToolbarActions.ts`
- [ ] T054 [US3] Mount `BottomActionToolbar` with full action set in rooms/chat view; preserve chat scroll position when opening or cancelling actions in `web/src/components/CollaborationRoomsView.tsx`
- [ ] T055 [US3] Render created toolbar action results as linked chat events using `web/src/lib/chatDisplayEvents.ts`
- [ ] T056 [US3] Verify New Goal flow (room appears, Prime streams, agent card join), success/failure/cancellation for all toolbar actions, context preservation, and Prime routing in `web/tests/components/ContextualToolbar.integration.test.tsx`

**Checkpoint**: All user stories are independently functional. New Goal → Room → Prime → agent join works end-to-end.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, accessibility review, design consistency, and FR compliance across all user stories.

- [ ] T057 [P] Run web unit and component tests with `npm test` from `web/` and confirm all pass
- [ ] T058 [P] Run web production build with `npm run build` from `web/` and confirm successful
- [ ] T059 Run backend tests with `npm test` from `backend/` (new routes in T029 and T045 require this)
- [ ] T060 Review new chat bubbles, cards, canvas controls, toolbar, and modal for keyboard reachability and accessible names in `web/src/components/agentCanvas/`
- [ ] T061 Review visual consistency: spacing, hierarchy, status colors, empty/error states, non-color-only indicators, fade-in animation across changed component files
- [ ] T062 Confirm toolbar renders inside canvas viewport and does not overlap sidebar at all viewport widths in `web/src/pages/CircuitView.tsx`
- [ ] T063 Confirm card positions are saved after drag and restored on reload (manual or test)
- [ ] T064 Confirm `touch-action: none` prevents browser scroll interference during canvas pan/pinch
- [ ] T065 Update implementation notes and manual acceptance evidence in `specs/017-expand-agent-canvas-ux/quickstart.md`
- [ ] T066 Confirm all requirements FR-001 through FR-024 are covered by implemented behavior or documented deferrals in `specs/017-expand-agent-canvas-ux/tasks.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1 — **blocks all user stories**.
- **US1 (Phase 3)**: Depends on Foundational. MVP.
- **US2 (Phase 4)**: Depends on Foundational. Independent of US1 except for shared status components.
- **US3 (Phase 5)**: Depends on Foundational. Integrates with US1 (chat rendering) and US2 (canvas card display).
- **Polish (Phase 6)**: Depends on desired stories being complete.

### User Story Dependencies

- **US1 (P1)**: No story dependencies.
- **US2 (P2)**: No story dependencies. DB migration (T028) and backend routes (T029) can start immediately after Phase 2.
- **US3 (P3)**: Backend extension T045 is independent. Frontend T047–T050 depend on T045 and T036 (canvas being wired).

### Within Each User Story

- Tests before implementation.
- Hooks/view-model before components.
- Components before page-level integration.
- Accessibility and error states before closing the story.

### Parallel Opportunities

- T002, T003, T004 in parallel after T001.
- T007, T008, T009 in parallel (Phase 2).
- US1: T012, T013, T014 in parallel; T016, T017 in parallel after T015.
- US2: T023, T024, T025 in parallel; T026, T027 in parallel; T029, T030, T034, T035 in parallel after T028; T031 after T030.
- US3: T041, T042, T043, T044 in parallel; T045 and T047 in parallel (independent backend/frontend); T049, T050 after T045+T036; T052, T053 in parallel.
- T057, T058 in parallel after implementation stabilizes.

---

## Parallel Example: User Story 2

```text
# These can run in parallel once Phase 2 is complete:
T026: Wire pointer-event pan handlers in useCanvasViewport.ts
T027: Wire scroll/pinch zoom handlers in useCanvasViewport.ts   ← same file, do after T026
T028: Add canvas_layouts DB migration in backend/src/db.ts

# After T028:
T029: Create canvas layout routes in backend/src/routes/canvas.ts
T030: Add fetchCanvasLayout/saveCanvasLayout in web/src/api.ts
T034: Create CircuitNodeCard component in agentCanvas/CircuitNodeCard.tsx
T035: Create CircuitCanvasControls component in agentCanvas/CircuitCanvasControls.tsx
```

## Parallel Example: User Story 3

```text
# Independent from each other:
T045: Extend POST /api/control-plane/goals (backend transaction)
T047: Create NewGoalModal component (frontend only)

# After T045:
T046: Update createGoal() return type in api.ts

# After T036 (canvas wired) and T045:
T049: Room card appears on canvas after goal creation
T050: Live agent-join SSE listener → canvas fade-in
```

---

## Implementation Strategy

### MVP (User Story 1 Only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (US1 — live chat activity).
3. Validate: distinct thinking/tool/approval/delegation bubbles in a live conversation.
4. Demo before continuing to US2/US3.

### Incremental Delivery

1. Setup + Foundational → Foundation ready.
2. US1 → Live chat activity MVP.
3. US2 → Spatial canvas with pan/zoom/drag/persistence + toolbar on canvas.
4. US3 → New Goal flow + full toolbar in both contexts.
5. Polish + verification.

### Recommended Delivery Order for This Feature

Given that US2 and US3 share the canvas context, implement US2 fully (including toolbar placement T037) before starting US3 canvas work (T049, T050). US3 backend (T045) can start in parallel with US2.

---

## Notes

- [P] = different files or no dependency on incomplete tasks.
- FR-010 (pan/zoom gestures) is satisfied by T026 + T027 + T036.
- FR-014 (toolbar on canvas) is satisfied by T037.
- FR-021 (New Goal → Room) is satisfied by T045 + T047 + T048.
- FR-022 (rooms are goal-spawned, never directly created) is satisfied by removing "New Room" from toolbar and implementing T045.
- FR-023 (Spawn Agent is a power-user action) is satisfied by T052/T053/T054.
- FR-024 (live agent-join visualization) is satisfied by T050 + T051.
- No new npm dependencies required.
- Canvas layout positions are UI state stored durably; they are not authoritative work records.
- Prime remains the sole agent-selection decision-maker; T051 implements Prime's goal_created handler.
