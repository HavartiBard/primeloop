# Tasks: Agentic Control Plane

**Input**: Design documents from `/specs/016-agentic-control-plane/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. Each task is formatted as a Gitea issue for pi-agent execution with `qwen3-coder-next`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and structure alignment for ACP work

- [x] T001 Create `backend/src/goals/` directory with service, types, and migration files per implementation plan
- [x] T002 [P] Create `backend/src/recovery/` directory with service and types for recovery events
- [x] T003 [P] Create `backend/src/learning/` directory with service and types for learning records
- [x] T004 [P] Create `web/src/pages/goals/` directory structure for goal workspace pages
- [x] T005 [P] Create `web/src/components/goal/` directory for goal-related UI components

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core database schema, base services, and shared types that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 Create ACP database migration in `backend/src/db.ts` adding tables: `goals`, `work_items`, `agent_roles`, `approvals`, `recovery_events`, `learning_records` with all fields from data-model.md
- [x] T007 [P] Create TypeScript type definitions in `backend/src/goals/types.ts` matching Goal, WorkItem, AgentRole schemas from data-model.md
- [x] T008 [P] Create TypeScript type definitions in `backend/src/recovery/types.ts` matching RecoveryEvent schema from data-model.md
- [x] T009 [P] Create TypeScript type definitions in `backend/src/learning/types.ts` matching LearningRecord schema from data-model.md
- [x] T010 [P] Seed initial AgentRole rows (Prime as singleton tier=prime, SRE/DevOps as tier=durable, Architect as tier=durable) in `backend/src/db.ts` migration
- [x] T011 Create base Goal service with CRUD operations in `backend/src/goals/service.ts` (createGoal, getGoal, listGoals, updateGoal, cancelGoal) implementing state transitions from data-model.md
- [x] T012 Create base WorkItem service with CRUD and dependency tracking in `backend/src/goals/work-item-service.ts` (createWorkItem, getWorkItem, listWorkItems, updateWorkItem, transitionStatus)
- [x] T013 Create shared WebSocket event broadcaster in `backend/src/ws/control-plane-events.ts` emitting event types from control-plane-events.md (goal.created, goal.updated, work-item.created, etc.)

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 — Direct Prime Through One Workspace (Priority: P1) 🎯 MVP

**Goal**: Operator can submit a goal to Prime, see it recorded and tracked, review progress and receive results in one control plane workspace without managing subordinate agents directly.

**Independent Test**: Create a goal via API or UI → confirm it appears as queued/in_progress → confirm Prime ownership is shown → confirm progress summary updates → confirm result summary on completion.

**Covers**: FR-001, FR-002, FR-006, FR-011, FR-012, SC-001, SC-002

### Implementation for User Story 1

- [x] T014 [US1] Implement goal intake API routes in `backend/src/routes/control-plane.ts` (POST /goals, GET /goals, GET /goals/:id, PATCH /goals/:id, POST /goals/:id/cancel) matching control-plane-api.yaml schemas
- [x] T015 [US1] Wire goal creation into Prime agent intake flow in `backend/src/prime-agent/service.ts` so that operator goals are enqueued as `chief_message` events and create durable Goal records with status=draft → queued
- [x] T016 [US1] Implement Prime-owned status updates in `backend/src/prime-agent/actions.ts` — when Prime processes a goal event, update the Goal's current_summary, status, and decision_summary fields
- [x] T017 [P] [US1] Create GoalList page component in `web/src/pages/goals/GoalList.tsx` showing all goals with title, status badge, priority, current_summary, updated_at using TanStack Query
- [x] T018 [P] [US1] Create GoalDetail page component in `web/src/pages/goals/GoalDetail.tsx` showing full goal intent, status timeline, work items list, approvals list, recovery events, and result_summary with loading/empty/error states
- [x] T019 [US1] Create CreateGoal form component in `web/src/components/goal/CreateGoalForm.tsx` with title, intent, priority fields and submission via POST /goals
- [x] T020 [US1] Add WebSocket subscription hook in `web/src/hooks/useControlPlaneEvents.ts` that connects to ws endpoint and merges goal.updated events into TanStack Query cache
- [x] T021 [US1] Wire goal work-items listing API in `backend/src/routes/control-plane.ts` (GET /goals/:id/work-items) returning WorkItem array matching control-plane-api.yaml

**Checkpoint**: User Story 1 is fully functional — operator can submit goals, track progress, and see results through Prime in one workspace

---

## Phase 4: User Story 2 — Prime Uses the Right Agents for the Job (Priority: P2)

**Goal**: Prime delegates parts of a goal to specialized agents (homelab, development, personal_assistant) so each task is handled by capable support staff without manual team assembly.

**Independent Test**: Submit one multi-part goal spanning ≥2 domains → verify Prime creates separate WorkItems with correct assigned_agent_role and domain → verify delegated work appears under parent goal → verify Prime incorporates outcomes into parent status.

**Covers**: FR-003, FR-004, FR-005, SC-004

### Implementation for User Story 2

- [x] T022 [US2] Implement Prime delegation decision logic in `backend/src/prime-agent/llm-router.ts` to produce structured delegate actions with assigned_agent_role, domain, scope, and title fields that create WorkItems via work-item-service
- [x] T023 [US2] Implement dispatchDelegate action in `backend/src/prime-agent/actions.ts` that creates a WorkItem (status=queued), delegates through fleet-executor dispatcher, and links the delegation to the WorkItem
- [x] T024 [US2] Wire delegation result routing in `backend/src/fleet-executor/result-router.ts` to update the parent WorkItem status (completed/failed/blocked) and outcome_summary when a delegated task finishes or fails
- [x] T025 [P] [US2] Create WorkItemCard component in `web/src/components/goal/WorkItemCard.tsx` showing work item title, assigned_agent_role badge, domain badge, status, scope, and outcome_summary
- [x] T026 [US2] Add delegated work visibility section to GoalDetail page (`web/src/pages/goals/GoalDetail.tsx`) showing work items grouped by status with live updates from WebSocket work-item events
- [x] T027 [US2] Implement domain-aware routing validation in `backend/src/routing/` to ensure Prime only routes to executable agent roles matching the required domain (homelab, development, personal_assistant, cross_domain)

**Checkpoint**: User Stories 1 AND 2 are both independently functional — Prime can delegate across domains and operator sees unified view

---

## Phase 5: User Story 3 — Prime Improves and Recovers Over Time (Priority: P3)

**Goal**: Prime detects failures, records recovery events, attempts safe recovery or escalation, and stores learning records from completed/failed goals to improve future execution.

**Independent Test**: Simulate a blocked/failed WorkItem → confirm RecoveryEvent is recorded with detected_condition and selected_action → confirm operator sees updated status → confirm LearningRecord is created on goal completion/failure.

**Covers**: FR-007, FR-008, FR-009, FR-010, SC-003

### Implementation for User Story 3

- [x] T028 [US3] Create RecoveryEvent service in `backend/src/recovery/service.ts` with createRecoveryEvent, listRecoveryEvents functions implementing detection → action selection (retry/reroute/escalate/request_approval/stop) → result recording
- [x] T029 [US3] Implement blocked-work detection in `backend/src/fleet-executor/result-router.ts` — when a WorkItem enters failed/blocked state, trigger recovery service to create RecoveryEvent and attempt selected action
- [x] T030 [US3] Create LearningRecord service in `backend/src/learning/service.ts` with createLearningRecord, listLearningRecords functions capturing observation, recommendation, signal_type, category on goal completion or terminal failure
- [x] T031 [US3] Wire post-goal learning capture in `backend/src/prime-agent/actions.ts` — when a Goal transitions to completed or failed, trigger learning service to generate LearningRecord from the goal outcomes
- [x] T032 [P] [US3] Implement approval request and resolution API routes in `backend/src/routes/control-plane.ts` (GET /goals/:id/approvals, POST /approvals/:id/decision) matching control-plane-api.yaml
- [x] T033 [US3] Wire approval gating into Prime action dispatch in `backend/src/prime-agent/actions.ts` — high-impact actions create Approval records (status=pending), pause goal execution, and resume on operator decision
- [x] T034 [P] [US3] Create RecoveryEventCard component in `web/src/components/goal/RecoveryEventCard.tsx` showing detected_condition, selected_action, result_status, result_summary with severity badge
- [x] T035 [P] [US3] Create ApprovalCard component in `web/src/components/goal/ApprovalCard.tsx` showing action_summary, risk_summary, approve/reject buttons calling POST /approvals/:id/decision
- [x] T036 [US3] Add recovery events and learning records sections to GoalDetail page (`web/src/pages/goals/GoalDetail.tsx`) with live updates from WebSocket recovery.recorded and learning-record.created events
- [x] T037 [US3] Implement approval WebSocket events in `backend/src/ws/control-plane-events.ts` emitting approval.requested and approval.resolved events

**Checkpoint**: All user stories are independently functional — Prime can delegate, recover from failures, request approvals, and learn from outcomes

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories — live updates polish, consistency, quickstart validation

- [x] T038 [P] Add approval queue page in `web/src/pages/approvals/ApprovalQueue.tsx` showing all pending approvals across goals with filter and bulk actions
- [x] T039 [P] Add learning records listing in `web/src/pages/learning/LearningRecords.tsx` showing all learning records with category/signal_type filters
- [x] T040 Ensure consistent loading, empty, success, and error states across all goal-related pages using existing Radix UI patterns
- [x] T041 Add goal status timeline visualization in `web/src/components/goal/StatusTimeline.tsx` showing state transitions with timestamps
- [x] T042 Run quickstart.md validation scenarios (Scenario 1-5) to verify end-to-end flows
- [x] T043 Review audit trails, observability logs, and artifact durability across all three user stories
- [x] T044 Review interaction consistency and visual polish across changed screens using existing ACP design patterns

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational phase — MVP deliverable
- **US2 (Phase 4)**: Depends on Foundational + US1 (needs GoalDetail, work-items API)
- **US3 (Phase 5)**: Depends on Foundational + US2 (needs delegation results, approval flow)
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational — No dependencies on other stories
- **US2 (P2)**: Depends on US1 for goal workspace and work-items API base
- **US3 (P3)**: Depends on US2 for delegation results to trigger recovery

### Parallel Opportunities

- All Phase 1 tasks marked [P] can run in parallel
- T007, T008, T009 (type definitions) can run in parallel within Phase 2
- T010 (seed data) and T006 (migration) can run in parallel
- T017, T018, T019 (US1 UI components) can run in parallel after T014 (API routes)
- T034, T035 (US3 UI cards) can run in parallel with T028-T031 (backend services)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test US1 independently via quickstart Scenario 1
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 → Validate → MVP!
3. Add US2 → Validate with multi-domain goal
4. Add US3 → Validate recovery and learning flows
5. Polish → Full feature complete

---

## Pi-Agent Execution Notes

Each task below is intended to be created as a Gitea issue and executed by a pi-agent using `qwen3-coder-next`. The issues include:

- Exact spec sections to read
- Validation baseline to check
- Allowed files scope
- Verification commands
- Architecture invariants to preserve (Prime stays native, no Prime-as-worker)
