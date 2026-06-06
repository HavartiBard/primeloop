---

description: "Task list for Agent Catalog implementation"
---

# Tasks: Agent Catalog

**Input**: Design documents from `specs/026-agent-catalog/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included — the spec's Success Criteria (SC-001…SC-009) require automated verification, and `quickstart.md` defines the coverage suite. TDD per constitution: write tests first, watch them fail, then implement.

**Organization**: Tasks are grouped by user story. Phase 2 (Foundational) is shared infrastructure that blocks all stories.

## Path Conventions

Web app: backend at `backend/src/`, tests at `backend/tests/`, UI at `web/src/`. Default local catalog store at `backend/catalog/` (gitignored).

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Add `yaml` dependency to `backend/package.json` and run `npm install` in `backend/`
- [ ] T002 [P] Create the default local catalog store: add `backend/catalog/.gitkeep` and add `backend/catalog/` to the repo `.gitignore`
- [ ] T003 [P] Create the catalog module skeleton: `backend/src/catalog/` with an `index.ts` barrel and an empty `backend/tests/catalog/` directory

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Add catalog schema to `backend/src/db.ts` (idempotent `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`): `catalog_sources`, `catalog_templates`, `catalog_template_versions`, `catalog_admission_events`, and `agents.catalog_template_version_id`; seed the `default-local` source row (per data-model.md)
- [ ] T005 [P] Define core types in `backend/src/catalog/types.ts`: `CatalogTemplate`, `AdmissionState`, `FailureCode`, `FailureReason`, `SyncEntryResult`, `TemplateVersion`, `CatalogSource` (per data-model.md + contracts/template-schema.md)
- [ ] T006 [P] Implement the safe-baseline definition + `isWithinBaseline()` in `backend/src/catalog/baseline.ts` (read-only bundles, no credential needs, no deploy/write-external primitives, empty egress) per research.md R5
- [ ] T007 [P] Implement required/optional field definitions and structural YAML parse in `backend/src/catalog/schema.ts` (emits `MISSING_REQUIRED_FIELD` / `INVALID_FIELD_TYPE`) per contracts/template-schema.md (depends on T005)
- [ ] T008 Implement the catalog DB store in `backend/src/catalog/store.ts`: CRUD for all `catalog_*` tables, content hashing, snapshot freeze + immutability guard (registered versions never mutated) per data-model.md (depends on T004, T005)
- [ ] T009 Implement the admission state machine + event logging in `backend/src/catalog/admission-state.ts`: legal transitions and append-only `catalog_admission_events` writes (actor + reason) per data-model.md (depends on T005, T008)
- [ ] T010 Implement the validator framework + reference resolver in `backend/src/catalog/validator.ts`: orchestrates structural validation (T007) and resolves references against `capability_bundle_adapters`, `mcp_servers`, `providers`, and the credential broker; returns `FailureReason[]` (rejection rule bodies added in US2) (depends on T005, T007, T008)
- [ ] T011 Create the `createCatalogRouter({ pool })` skeleton in `backend/src/routes/catalog.ts` and mount it at `/api/catalog` in `backend/src/app.ts` (handlers added per story)
- [ ] T012 Define observability + operational ownership for the feature: structured log points for sync/validate/approve/instantiate, and document the rollback path and admission-event audit trail in `backend/src/catalog/index.ts` header comment (per plan.md SRE section)

**Checkpoint**: Schema, types, store, state machine, validator framework, and router are ready — user stories can begin.

---

## Phase 3: User Story 1 - Import an approved template into the runtime (Priority: P1) 🎯 MVP

**Goal**: Carry one valid local template from `discovered` → `validated` → approve → `registered` → instantiate (`active`) as a managed agent, with provenance recorded and no eager runtime boot.

**Independent Test**: Place one valid template in `backend/catalog/`, sync, approve, instantiate; confirm a `capability_profiles` row + an `agents` row linked via `catalog_template_version_id`, grants no broader than declared, and no process started until work arrives.

### Tests for User Story 1 ⚠️ (write first, must fail)

- [ ] T013 [P] [US1] Contract test for the happy-path API (`POST /sync` local, `POST .../approve`, `POST .../instantiate`) in `backend/tests/catalog/api.us1.test.ts` (per contracts/catalog-api.md)
- [ ] T014 [P] [US1] Integration test for the full admission flow (discovered→active), provenance recorded, and **no eager boot** in `backend/tests/catalog/admission.test.ts`
- [ ] T015 [P] [US1] Unit test for the template→capability-profile/tool-grant mapping in `backend/tests/catalog/mapper.test.ts` (grant intersection, SC-005)

### Implementation for User Story 1

- [ ] T016 [P] [US1] Implement the local source reader in `backend/src/catalog/source.ts`: list/read YAML files from a local source and resolve `{ file: ... }` references for `systemPrompt`/`soul`/`persona` into a fully-resolved definition
- [ ] T017 [US1] Implement the registrar in `backend/src/catalog/registrar.ts`: on approval, upsert a `capability_profiles` row from the declared profile, freeze the version snapshot, set `catalog_templates.current_version_id`, and record the `capability_profile_id` (depends on T008, T009)
- [ ] T018 [US1] Implement instantiation in `backend/src/catalog/instantiate.ts`: registered version → `agents` row (tier from `lifecycleIntent`) + `agent_runtime_configs` + `agent_mcp_assignments` + `tool_grant_defaults`, linked via `catalog_template_version_id`; **no process boot**; return `CREDENTIAL_NOT_PROVISIONED` block when a declared credential is absent (depends on T017)
- [ ] T019 [US1] Wire the admission sync orchestration (local) in `backend/src/catalog/admission.ts`: discovered → validate → validated; return `SyncEntryResult[]` (depends on T010, T016)
- [ ] T020 [US1] Implement US1 endpoints in `backend/src/routes/catalog.ts`: `GET /templates`, `GET /templates/:id`, `POST /sync` (local), `POST /templates/:id/versions/:v/validate`, `POST /templates/:id/versions/:v/approve`, `POST /templates/:id/versions/:v/instantiate` (depends on T017, T018, T019)
- [ ] T021 [US1] Integrate approval-queue linkage: approval creates/links an `approvals` row and records the `approval_id` on the version (per data-model.md)
- [ ] T022 [US1] Add structured logging + error handling for sync/approve/instantiate and append admission events with `actor` for each transition in `backend/src/routes/catalog.ts` and `backend/src/catalog/admission.ts`
- [ ] T023 [P] [US1] Build the Catalog admin view in `web/src/` (list templates with admission-state badges, detail view, Approve + Instantiate actions) reusing settings/admin (021) + approval-queue (008) patterns, with loading/empty/success/error states

**Checkpoint**: A valid local template can be imported, approved, registered, and instantiated end-to-end (SC-001). MVP complete.

---

## Phase 4: User Story 2 - Author and validate with clear failure modes (Priority: P2)

**Goal**: Every malformed, over-privileged, or under-specified template is rejected with a specific named reason and never reaches approval; corrected templates can re-validate.

**Independent Test**: Feed a fixture set of intentionally broken templates; confirm each is `rejected` with the correct `FailureCode` and is not approvable, while valid entries in the same batch still admit.

### Tests for User Story 2 ⚠️ (write first, must fail)

- [ ] T024 [P] [US2] Validator failure-matrix unit tests in `backend/tests/catalog/validator.test.ts` — one case per code: `MISSING_REQUIRED_FIELD`, `INVALID_FIELD_TYPE`, `UNKNOWN_CAPABILITY_BUNDLE`, `UNKNOWN_PLATFORM_PRIMITIVE`, `UNKNOWN_MCP_SERVER`, `UNKNOWN_CREDENTIAL`, `UNKNOWN_PROVIDER`, `LEAST_PRIVILEGE_VIOLATION`, `SECRET_VALUE_PRESENT`, `DUPLICATE_TEMPLATE_ID`, `VERSION_CONFLICT`, `APPROVAL_POLICY_DOWNGRADED` (SC-002)
- [ ] T025 [P] [US2] Integration test for batch isolation in `backend/tests/catalog/sync-batch.test.ts`: one invalid entry rejected while others admit (FR-015), and a rejected entry never reaches `pending_approval`
- [ ] T026 [P] [US2] Create broken-template fixtures in `backend/tests/catalog/fixtures/` (one file per failure code)

### Implementation for User Story 2

- [ ] T027 [US2] Implement semantic rejection rules in `backend/src/catalog/validator.ts`: emit `UNKNOWN_*` for unresolved references, `LEAST_PRIVILEGE_VIOLATION` when `toolAccess`/`mcpAccess`/`credentialNeeds` exceed the declared capability profile, and `SECRET_VALUE_PRESENT` for inline secrets (depends on T010)
- [ ] T028 [US2] Add duplicate/version-conflict detection (`DUPLICATE_TEMPLATE_ID`, `VERSION_CONFLICT`) across a sync batch in `backend/src/catalog/admission.ts`
- [ ] T029 [US2] Implement the `APPROVAL_POLICY_DOWNGRADED` warning: `autoEligible` templates whose grants exceed the safe baseline are forced to human approval (not rejected) in `backend/src/catalog/admission.ts` (depends on T006)
- [ ] T030 [US2] Implement the reject → correct → re-validate loop in `backend/src/catalog/admission.ts`: re-syncing a corrected file restarts at `discovered` and can reach `validated` (FR-007 last scenario)
- [ ] T031 [US2] Surface `failure_reasons` in `GET /templates/:id` and the Catalog admin view (rejected badge + reason list) in `backend/src/routes/catalog.ts` and `web/src/`
- [ ] T032 [US2] Add per-entry sync outcome reporting + logs in `backend/src/catalog/admission.ts` so an operator can diagnose any non-admission (SC-008)

**Checkpoint**: Bad templates are provably rejected with named reasons; good templates still flow (SC-002).

---

## Phase 5: User Story 3 - Publish & sync from a pinned Git commit, with versioning & rollback (Priority: P2)

**Goal**: Sync approved entries from a Git commit SHA (recording immutable provenance), retain prior registered versions, roll back, and deprecate — without disturbing running agents.

**Independent Test**: Sync from SHA A (v1), then SHA B (v2), roll back to v1; confirm the current version reflects the rollback, history is retained, and a running agent from a prior instantiation is unaffected.

### Tests for User Story 3 ⚠️ (write first, must fail)

- [ ] T033 [P] [US3] Integration test for Git sync provenance in `backend/tests/catalog/git-sync.test.ts`: a moving ref resolves to a concrete SHA recorded on each version (FR-013/FR-014)
- [ ] T034 [P] [US3] Integration test for versioning + rollback in `backend/tests/catalog/rollback.test.ts`: v1→v2→rollback, history retained, running agent unaffected (SC-004, SC-006)
- [ ] T035 [P] [US3] Integration test for deprecate in `backend/tests/catalog/deprecate.test.ts`: new instantiation blocked/warned, running agents continue (FR-024)

### Implementation for User Story 3

- [ ] T036 [US3] Implement the Git source reader in `backend/src/catalog/source.ts`: `child_process` `git rev-parse <ref>` (ref→SHA), `git ls-tree`/`git show <sha>:<path>` to read templates at a commit; record `commit_sha`/`source_ref`/`source_path` (depends on T016)
- [ ] T037 [US3] Implement `GET /sources` and `POST /sources` (add/update local or git source) in `backend/src/routes/catalog.ts` (per contracts/catalog-api.md)
- [ ] T038 [US3] Extend the `POST /sync` handler in `backend/src/routes/catalog.ts` to accept `{ sourceId, ref }`, resolve the SHA via `source.ts`, and record provenance on each version (depends on T036)
- [ ] T039 [US3] Implement versioning in `backend/src/catalog/store.ts`/`registrar.ts`: registering a new version retains prior registered versions and updates the current pointer
- [ ] T040 [US3] Implement `POST /templates/:id/rollback` (set current to a prior registered version, log events on both) and `POST /templates/:id/deprecate` (set `lifecycle_state`, block/warn new instantiation) in `backend/src/routes/catalog.ts` (depends on T039)
- [ ] T041 [P] [US3] Add version-history, rollback, and deprecate controls to the Catalog admin view in `web/src/`, plus a Source configuration panel, reusing existing patterns

**Checkpoint**: Versioned Git provenance, rollback, and deprecation work without touching running agents.

---

## Phase 6: User Story 4 - Orchestrator curates & instantiates from templates (Priority: P3)

**Goal**: Prime selects a registered template for an intent, proposes instantiation with a rationale, and instantiates within declared bounds — routing through approval when required.

**Independent Test**: Give Prime an intent matching a registered template; confirm `propose_instantiation` returns a rationale and `instantiate` on a non-baseline template returns `pending_approval` (no agent created), while grants never exceed the declaration.

### Tests for User Story 4 ⚠️ (write first, must fail)

- [ ] T042 [P] [US4] Contract tests for the catalog control-plane tools in `backend/tests/catalog/orchestrator-tools.test.ts`: `catalog.list_registered`, `catalog.propose_instantiation`, `catalog.instantiate` (approval routing + grant-bound guarantees) per contracts/orchestrator-skill.md

### Implementation for User Story 4

- [ ] T043 [US4] Implement the catalog control-plane tools in `backend/src/catalog/orchestrator-tools.ts`: `list_registered`, `propose_instantiation` (rationale + `requiresHumanApproval` via baseline), `instantiate` (routes through approval queue, returns `pending_approval`/`active`/`blocked`) (depends on T018, T006)
- [ ] T044 [US4] Register the catalog tools via `backend/src/mcp/service.ts` `listControlPlaneTools` / `callControlPlaneTool` so Prime can call them
- [ ] T045 [US4] Add the orchestrator skill prompt doc describing curation behavior (map intent → template → propose → instantiate) under `backend/prompts/` or `web/`-served skill location, per contracts/orchestrator-skill.md
- [ ] T046 [US4] Record `actor: 'prime'` admission events for proposals/instantiations in `backend/src/catalog/orchestrator-tools.ts` and ensure no direct DB writes bypass the tools

**Checkpoint**: Prime can curate and instantiate templates safely within declared bounds.

---

## Phase 7: User Story 5 - Migrate manually-created agents & move config out of code (Priority: P3)

**Goal**: Generate draft templates from existing in-code definitions (the seed catalog), repoint spawn/bootstrap to read the catalog, and adopt migrated templates without interrupting running agents.

**Independent Test**: Run migration; confirm drafts for the in-code templates reach `validated`, that spawn/bootstrap behave identically after seeding (SC-009), and that adopting a migrated template does not interrupt a running agent.

### Tests for User Story 5 ⚠️ (write first, must fail)

- [ ] T047 [P] [US5] Migration parity test in `backend/tests/catalog/migrate.test.ts`: drafts generated from `DEFAULT_EPHEMERAL_TEMPLATES` + `DEFAULT_DURABLE_STAFF` validate, and the resolved definitions match the in-code defs (SC-009)
- [ ] T048 [P] [US5] Spawn/bootstrap parity test in `backend/tests/catalog/seed-parity.test.ts`: after seeding, `spawnEphemeralAgent` and `bootstrapDurableStaff` produce the same agents/grants as the in-code baseline
- [ ] T049 [P] [US5] Integration test in `backend/tests/catalog/migrate-adopt.test.ts` that adopting a migrated template does not interrupt a running agent and links it via `catalog_template_version_id` (FR-028)

### Implementation for User Story 5

- [ ] T050 [US5] Implement the migrator in `backend/src/catalog/migrate.ts`: read `DEFAULT_EPHEMERAL_TEMPLATES`, `DEFAULT_DURABLE_STAFF`, and `prompts/agents/*` → emit validated YAML drafts; `POST /api/catalog/migrate` (`write` option writes to the default-local source) per contracts/catalog-api.md
- [ ] T051 [US5] Generate and commit the built-in seed catalog files into `backend/catalog/` from the migrator output (FR-034)
- [ ] T052 [US5] Repoint `spawnEphemeralAgent` in `backend/src/ephemeral-templates.ts` to source definitions from the catalog, retaining the in-code literals only as a fallback (FR-035)
- [ ] T053 [US5] Repoint `bootstrapDurableStaff` in `backend/src/durable-staff.ts` to seed/register/instantiate durable staff from the catalog (FR-035)
- [ ] T054 [US5] Link migrated/seeded agents to their `catalog_template_version_id` and add the Migrate action to the Catalog admin view in `web/src/`

**Checkpoint**: Agent configuration lives in the catalog, not in code; existing agents are uninterrupted (SC-009).

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T055 [P] Run `quickstart.md` end-to-end against a live instance and record results
- [ ] T056 [P] Performance check: sync + validate a ~100-template catalog within a few seconds (plan.md performance goal)
- [ ] T057 Security review: confirm no secret values are accepted in files, effective grants = declaration ∩ runtime policy on every path, and brokered credentials are never inlined
- [ ] T058 Review audit trail + observability across all stories (admission events complete, per-entry outcomes, structured logs)
- [ ] T059 [P] Review interaction consistency and visual polish across the Catalog admin screens (badges, empty/error states) against settings/approval patterns
- [ ] T060 [P] Documentation: add a Catalog section to `docs/` covering authoring, sync, approval, rollback, and migration
- [ ] T061 Update `AGENTS.md`/`CLAUDE.md` references if catalog-sourced agent config changes any Prime implementation constraints

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup. **Blocks all user stories.**
- **User Stories (Phase 3–7)**: All depend on Foundational. US1 is the MVP. US2/US3 build on US1's pipeline; US4/US5 build on registration + instantiation (US1).
- **Polish (Phase 8)**: Depends on the desired stories being complete.

### User Story Dependencies

- **US1 (P1)**: After Foundational. No dependency on other stories.
- **US2 (P2)**: After Foundational; exercises US1's sync/approve path but is independently testable via fixtures (validator core is foundational).
- **US3 (P2)**: After US1 (reuses registration/instantiation + endpoints).
- **US4 (P3)**: After US1 (needs registered templates + instantiation).
- **US5 (P3)**: After US1 (registration/instantiation) and benefits from US2's validation.

### Within Each User Story

- Tests written first and failing, then models/services, then endpoints, then UI/integration.
- Admission events + observability before closing a story.

### Parallel Opportunities

- Setup: T002, T003 in parallel.
- Foundational: T005, T006, T007 in parallel (then T008 → T009 → T010).
- US1 tests T013–T015 in parallel; T016 and T023 (UI) parallel to backend services.
- US2 tests T024–T026 in parallel.
- US3 tests T033–T035 in parallel.
- Once Foundational + US1 land, US2/US3 (one pair) and US4/US5 can be staffed in parallel by different developers.

---

## Parallel Example: User Story 1

```bash
# Tests first (parallel):
Task: "Contract test happy-path API in backend/tests/catalog/api.us1.test.ts"
Task: "Integration test admission flow in backend/tests/catalog/admission.test.ts"
Task: "Mapper unit test in backend/tests/catalog/mapper.test.ts"

# Then parallel implementation where files differ:
Task: "Local source reader in backend/src/catalog/source.ts"
Task: "Catalog admin view in web/src/"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → 4. **STOP & VALIDATE** (import→approve→register→instantiate end-to-end, SC-001) → 5. Demo.

### Incremental Delivery

Foundation → US1 (MVP) → US2 (safety guarantees) → US3 (versioning/rollback) → US4 (Prime curation) → US5 (config out of code). Each story is an independently testable increment.

---

## Notes

- [P] = different files, no incomplete dependencies.
- The validator *framework* is foundational; US2 adds the rejection-rule bodies + the failure-mode guarantee.
- The catalog never mutates a registered snapshot or a running managed agent — verify this invariant in US3 rollback and US5 migration tests.
- Commit after each task or logical group; run DB-backed tests via `npm run test:db` (requires `npm run test:db:up`).
