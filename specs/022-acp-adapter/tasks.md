# Tasks: ACP Adapter Standardization

**Input**: Design documents from `specs/022-acp-adapter/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Not explicitly requested in spec. Unit tests are included for the ACP client/mapper/policy (novel, high-complexity protocol logic). Integration test for the dispatch path. No TDD-first discipline required.

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete-task dependencies)
- **[Story]**: User story label (US1–US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install the ACP library and scaffold the new module structure. No logic yet.

- [X] T001 Install `@zed-industries/agent-client-protocol` in `backend/package.json` and verify types resolve
- [X] T002 [P] Create `backend/src/acp/` directory with empty index barrel: `backend/src/acp/types.ts`
- [X] T003 [P] Create `backend/tests/acp/` directory with a placeholder test file to confirm Vitest picks it up

**Checkpoint**: `npm install` clean, `backend/src/acp/` exists, test runner finds `tests/acp/`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core ACP protocol layer and `HarnessEvent` mapping that all user stories depend on. Must be complete before any harness work or consumer wiring.

**⚠️ CRITICAL**: No user story phase can begin until this phase is complete.

- [X] T004 Define local ACP type re-exports and any project-specific narrow types (e.g. `AcpSessionState`) in `backend/src/acp/types.ts`
- [X] T005 [P] Implement `AcpClient` class (stdio JSON-RPC over `child_process`) — `initialize`, `session/new`, `session/prompt`, `session/cancel` — in `backend/src/acp/client.ts`. Client handles incoming `session/update` notifications and dispatches inbound `session/request_permission` / `fs/*` callbacks to registered handlers.
- [X] T006 [P] Implement `updateMapper` — pure function mapping `SessionUpdate` variants to `HarnessEvent` — in `backend/src/acp/update-mapper.ts` (table: research D3 / harness-contract.md)
- [X] T007 [P] Unit tests for `AcpClient` message framing, `initialize` handshake, and `session/prompt` lifecycle against a mock subprocess in `backend/tests/acp/client.test.ts`
- [X] T008 [P] Unit tests for `updateMapper` covering all `SessionUpdate` variants → `HarnessEvent` in `backend/tests/acp/update-mapper.test.ts`
- [X] T009 Implement sandboxed `fs` handler — `fs/read_text_file` and `fs/write_text_file` with symlink-aware path confinement to sandbox root — in `backend/src/acp/fs-handler.ts`
- [X] T010 [P] Unit tests for `fs-handler` covering in-sandbox reads/writes, out-of-sandbox rejection, symlink escapes, and non-absolute paths in `backend/tests/acp/fs-handler.test.ts`

**Checkpoint**: `AcpClient`, `updateMapper`, and `fs-handler` pass their unit tests. No harness or permission logic yet.

---

## Phase 3: User Story 1 — Connect a standard ACP agent end-to-end (Priority: P1) 🎯 MVP

**Goal**: An ACP-compliant agent registered with `runtime_family = 'acp'` dispatches, runs, streams to the canvas, and completes through the existing fleet path with no runtime-specific adapter code.

**Independent Test**: Register one ACP agent (Gemini CLI), dispatch a task, confirm task starts → streams `session/update` updates to canvas → settles terminal status. Zero new runtime-specific code added. See `quickstart.md` steps 1–2.

### Implementation

- [X] T011 [US1] Implement `AcpHarness implements AgentHarness` — `start()` (spawn + `initialize` + capability reconciliation), `dispatch()` (`session/new` + `session/prompt` + stream), `abort()` (`session/cancel`), `close()` (terminate + reap) — in `backend/src/fleet-executor/acp-harness.ts`. Wire `updateMapper` and `AcpClient`. On crash/malformed message: settle `task_end` as failed, reap subprocess.
- [X] T012 [US1] Modify `backend/src/opencode/process-manager.ts` to select `AcpHarness` for agents with `runtime_family = 'acp'`, `PiHarness` otherwise. Harness stored in the existing `piHarnesses` map (or a unified map).
- [X] T013 [US1] Implement capability reconciliation in `AcpHarness.start()` — after `initialize`, call `updateAgent(pool, agentId, { capabilities: negotiatedCapabilities })` so registry `capabilities[]` reflects the handshake. Refuse dispatch to an unadvertised capability (FR-013).
- [X] T014 [US1] Emit `runtime_event` entries for session lifecycle: `acp.session.started`, `acp.session.completed`, `acp.session.failed`, `acp.session.cancelled` — in `AcpHarness` using the existing `runtime_events` insert pattern.
- [X] T015 [P] [US1] Integration test: dispatch a task to a stub ACP agent (subprocess that speaks ACP over stdio) through `FleetDispatcher` → `AcpHarness`, assert `HarnessEvent` stream and terminal `TaskResult` in `backend/tests/fleet-executor/acp-harness.test.ts`
- [X] T016 [US1] Register a test ACP agent entry in the dev database seed / docs — add an example `agents` row with `runtime_family = 'acp'`, launch command, and `workspace_root` to `backend/src/migrations/` (or seed script) so the quickstart works without manual SQL

**Checkpoint**: US1 independently verifiable — Gemini CLI (or stub) completes a dispatched task end-to-end. Canvas shows streamed events. SC-001/SC-002/SC-004 satisfied.

---

## Phase 4: User Story 2 — Permission requests gate execution (Priority: P1)

**Goal**: `session/request_permission` is classified by risk; low-risk auto-resolves, sensitive gates to the approval queue; fail-safe deny timeout if unanswered.

**Independent Test**: Trigger low-risk action → no approval item, agent continues. Trigger sensitive action → approval item appears, blocks agent. Approve → agent continues. Deny/timeout → agent aborts. See `quickstart.md` step 3.

### Implementation

- [X] T017 [US2] Implement `PermissionPolicy` classifier and `resolvePermission()` bridge in `backend/src/acp/permission.ts` — reads per-agent config (`agents.config.permission`), classifies `toolCall`, auto-responds for low-risk, creates approval-queue item for sensitive (reuse existing approval insert pattern from `routes/approvals.ts`), wires deny-timeout via `setTimeout` with fail-safe `reject_once` response (FR-005, FR-006a).
- [X] T018 [US2] Wire `resolvePermission()` into `AcpClient` as the `session/request_permission` callback handler in `backend/src/acp/client.ts`. Cancellation path: on `abort()`, cancel pending permission promises with `{ outcome: 'cancelled' }`.
- [X] T019 [US2] Emit `runtime_event` for each permission decision: `acp.permission.auto_resolved`, `acp.permission.gated`, `acp.permission.approved`, `acp.permission.denied`, `acp.permission.timeout` — in `permission.ts` for observability (SC-007).
- [X] T020 [P] [US2] Unit tests for `permission.ts` — low-risk auto-resolve, sensitive gate, timeout deny, cancelled on task abort, approval-queue integration (mock) — in `backend/tests/acp/permission.test.ts`
- [X] T021 [US2] Add default `permission` config shape to the example agent seed/migration from T016 and document the config fields in `quickstart.md`

**Checkpoint**: US2 independently verifiable — sensitive permission gates, low-risk resolves, timeout denies. SC-003/SC-007 satisfied.

---

## Phase 5: User Story 3 — Cancellation mid-turn (Priority: P2)

**Goal**: An in-progress ACP session can be cancelled; agent halts, task settles terminal, no orphaned subprocess.

**Independent Test**: Start a long-running task, cancel mid-turn → `session/cancel` sent, agent halts with `stopReason: cancelled`, task terminal state, `ps` shows no orphan. See `quickstart.md` step 4.

### Implementation

- [X] T022 [US3] Verify `AcpHarness.abort()` sends `session/cancel` correctly and that `close()` reaps the subprocess unconditionally (SIGTERM then SIGKILL after grace period) — add edge-case handling for crash-before-cancel and cancel-while-blocked-on-permission to `backend/src/fleet-executor/acp-harness.ts`
- [X] T023 [P] [US3] Unit/integration tests for cancellation: cancel-during-prompt, cancel-during-permission-wait, crash-before-cancel, all settle as terminal with no orphan — extend `backend/tests/fleet-executor/acp-harness.test.ts`

**Checkpoint**: US3 independently verifiable — cancel settles cleanly, no orphan. SC-005 satisfied.

---

## Phase 6: User Story 4 — Legacy adapters deprecate gracefully (Priority: P2)

**Goal**: Existing `opencode`/`generic-http` adapters are marked deprecated and function unchanged via shims for any agent not yet on ACP.

**Independent Test**: Agent with a legacy `runtime_family` dispatches and behaves identically to before the change. Shims are annotated `@deprecated`. See `quickstart.md` step 5.

### Implementation

- [X] T024 [US4] Annotate `backend/src/adapters/opencode.ts` and `backend/src/adapters/generic-http.ts` with `@deprecated` JSDoc comments noting the removal condition ("remove when no agent depends on this path") and link to this spec
- [X] T025 [US4] Update `backend/src/adapters/index.ts` to add `acp` to the `runtime_family` switch (routing it away from HTTP shims) and add a `@deprecated` comment on the legacy cases
- [X] T026 [P] [US4] Verify existing adapter unit/integration tests still pass unchanged — run `npm run test` targeting `tests/adapters/` and confirm green

**Checkpoint**: US4 independently verifiable — legacy agents work via shims; ACP family routes to `AcpHarness`. SC-006 satisfied.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Observability completeness, cleanup, and quickstart validation.

- [X] T027 [P] Review all new `runtime_event` inserts for consistent `event_type` naming (`acp.*`) and ensure payloads include `agent_id`, `session_id`, `delegation_id` for correlation — `backend/src/acp/` and `fleet-executor/acp-harness.ts`
- [X] T028 [P] Add process-manager logging for ACP harness selection, spawn, and reap at appropriate log levels in `backend/src/opencode/process-manager.ts`
- [X] T029 Update `AGENTS.md` (or equivalent) with the ACP agent registration format (`runtime_family: acp`, `config.acp`, `config.permission`) so operators can register agents without reading source
- [X] T030 Run the full `quickstart.md` validation — spawn Gemini CLI (or best available ACP-capable agent), complete all 5 verification steps, confirm SC-001 through SC-007
- [X] T031 [P] Run full backend test suite (`npm run test` + `npm run test:db`) and confirm zero regressions on existing adapter, harness, and dispatch tests

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — **BLOCKS all user story phases**
- **Phase 3 (US1)**: Depends on Phase 2 — MVP, deliver first
- **Phase 4 (US2)**: Depends on Phase 3 — requires `AcpClient` callback wiring from T011
- **Phase 5 (US3)**: Depends on Phase 3 — extends `AcpHarness.abort()` from T011/T022
- **Phase 6 (US4)**: Depends on Phase 2 — independent of US1–US3, can run in parallel with Phase 4/5
- **Phase 7 (Polish)**: Depends on all desired stories complete

### User Story Dependencies

- **US1 (P1)**: Requires Foundational (Phase 2) only — no story dependencies
- **US2 (P1)**: Requires US1 complete (`AcpClient` callback wiring in T011)
- **US3 (P2)**: Requires US1 complete (`AcpHarness.abort()` from T011)
- **US4 (P2)**: Requires Foundational only — can run in parallel with US1

### Within Each Phase

- T005 and T006 are parallel (different files, no shared dependency)
- T007/T008/T010 are parallel unit tests — write after their target file, run before wiring
- T011 (AcpHarness) must precede T012 (process-manager selection), T013, T014
- T017 (permission policy) must precede T018 (wire into AcpClient)
- T022 (abort edge cases) can be verified in parallel with T023 (tests)

---

## Parallel Execution Examples

### Phase 2 (Foundational) — can parallelize:

```
Agent A: T005 — AcpClient (client.ts)
Agent B: T006 — updateMapper (update-mapper.ts)
Agent C: T009 — fs-handler (fs-handler.ts)
         T007/T008/T010 — unit tests follow each file
```

### Phase 3 (US1) — sequential core, parallel support:

```
T011 — AcpHarness (core, serial)
  └─ T012 — process-manager selection
  └─ T013 — capability reconciliation
  └─ T014 — lifecycle runtime_events
  └─ T015 [P] — integration test (can write alongside T011 impl)
T016 [P] — seed/migration (independent)
```

### Phase 6 (US4) — runs in parallel with Phase 4/5:

```
Agent B: T024 — deprecate opencode.ts
         T025 — update adapters/index.ts
         T026 — verify existing tests still pass
```

---

## Implementation Strategy

### MVP First (US1 only — Phase 1 + 2 + 3)

1. Phase 1: Install dependency, scaffold `backend/src/acp/`
2. Phase 2: `AcpClient`, `updateMapper`, `fs-handler` + unit tests
3. Phase 3: `AcpHarness` + process-manager + capability reconciliation + lifecycle events
4. **STOP and VALIDATE**: Register Gemini CLI, dispatch one task, confirm canvas parity (SC-001/SC-004)
5. Ship US1 — permission gating and cancellation can follow

### Incremental Delivery

1. Setup + Foundational → ACP protocol layer ready
2. US1 → first ACP agent runs end-to-end (**MVP**)
3. US2 → permission requests gated safely
4. US3 + US4 (parallel) → cancellation clean + legacy deprecated
5. Polish → operational completeness + quickstart confirmed

### Delegation to local LLM (Pi)

Phase 2 tasks (T005–T010) are well-suited for parallel delegation: each is a self-contained file
with precise inputs (contracts/acp-client.md, contracts/harness-contract.md, contracts/permission-policy.md,
data-model.md) and verifiable outputs (unit tests). Phase 3 T011 is the complex core — recommend
keeping that in the main session. Phase 6 (T024–T026) is mechanical and safe to delegate.

---

## Notes

- `[P]` tasks touch different files and have no incomplete-task dependencies — safe to parallelize
- Each story checkpoint is independently verifiable against `quickstart.md`
- Legacy adapters (`opencode.ts`, `generic-http.ts`) are **not deleted** in this feature — only deprecated. Deletion is a tracked follow-up once no agent registration references them.
- The `@zed-industries/agent-client-protocol` package name should be verified against the published npm package name before T001 — the library may be published under a different scope.
