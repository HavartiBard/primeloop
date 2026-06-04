---
description: "Task list for Managed-Agent Runtime Alignment (024)"
---

# Tasks: Managed-Agent Runtime Alignment

**Input**: Design documents from `/specs/024-managed-agent-runtime/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included — this is a high-risk reliability + security feature; the spec
defines an Independent Test per story plus SC-001…SC-007. Test tasks are DB-backed
(Vitest, `TEST_DATABASE_URL`) and isolation tests.

**Organization**: Grouped by user story. Story phases are ordered by spec priority
(P1 → P2 → P3). The shared session substrate lives in Foundational because the P1 MVP
(US1) builds on it; US4 then delivers the operator-facing unified timeline.

## Path Conventions

Web app: `backend/src/...`, `backend/tests/*.test.ts`, `web/src/...`. All paths below
are repository-relative (worktree root).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Module skeletons, feature flags, and shared constants

- [X] T001 [P] Create backend module skeletons with `types.ts`/`index.ts` stubs in `backend/src/session/`, `backend/src/credentials/`, `backend/src/proxy/`, `backend/src/runtime/`
- [X] T002 [P] Add feature-flag plumbing (`RESUME_ON_RESTART`, `LAZY_PROVISIONING`, `CREDENTIAL_BROKER`, `EGRESS_SANDBOX`) read from env in `backend/src/index.ts` config wiring
- [X] T003 [P] Add typed runtime-event constants for new event types (`session.resumed`, `delegation.recovered`, `delegation.recovered_failed`, `credential.issued|rotated|revoked|risk_flagged`, `runtime.leased|reclaimed`, `egress.denied`, `fs.denied`, `llm.proxied`, `launcher.auth_denied`) in `backend/src/runtime-event-types.ts`
- [X] T064 [P] Author `scripts/setup.sh` to generate the docker-compose (primary + runtime container on a private network, default-deny egress to the proxy) parameterized by operator-selected runtimes (FR-024); pairs with the runtime image (T061)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, session substrate, and observability that the P1 MVP and later stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Idempotent migration in `backend/src/db.ts`: add `runtime_events.session_id UUID` and `seq BIGINT`, `UNIQUE (session_id, seq)`, plus one-time backfill of `session_id` (from `delegation_id`/thread→prime session) and `seq` ordering
- [X] T005 [P] Idempotent migration in `backend/src/db.ts`: create `brokered_credentials` table + index `(agent_id, status)` per data-model.md
- [X] T006 [P] Idempotent migration in `backend/src/db.ts`: create `runtime_leases` table + indexes `(agent_id, status)` and `(status, last_activity_at)`
- [X] T007 [P] Idempotent migration in `backend/src/db.ts`: create `egress_allowlist` table + `UNIQUE (agent_id, host)`
- [X] T008 [P] Idempotent migration in `backend/src/db.ts`: add `delegations.recovery_epoch INT NOT NULL DEFAULT 0`
- [X] T009 Assign `session_id` + monotonic `seq` on every event write in `insertRuntimeEvent` in `backend/src/runtime.ts`
- [X] T010 Implement `SessionStore` core (`appendEvent`, `getSession`, `getEvents({from,to,last})` bounded range queries) in `backend/src/session/store.ts` and `backend/src/session/types.ts` per contracts/session-store.md
- [X] T011 [P] DB-backed test for the session substrate (session_id/seq assignment, bounded `getEvents`) in `backend/tests/session-store.test.ts`
- [X] T012 Define observability + rollback wiring: emit-helper for new event types and confirm both legacy and new paths are flag-gated, in `backend/src/runtime.ts`

**Checkpoint**: Schema migrated, session log is sliceable and authoritative — user stories can begin

---

## Phase 3: User Story 1 - In-flight work survives a restart (Priority: P1) 🎯 MVP

**Goal**: A backend/runtime restart resumes in-flight delegations (durable in place, ephemeral re-dispatched) instead of failing them; no silent loss.

**Independent Test**: Start ≥2 delegations, restart the backend mid-flight; each resumes to completion or shows a recorded recovery outcome (SC-001).

### Tests for User Story 1

- [X] T013 [P] [US1] DB-backed integration test: durable delegation resumes in place after restart, emits `session.resumed` in `backend/tests/recovery.resume.test.ts`
- [X] T014 [P] [US1] DB-backed integration test: ephemeral delegation re-dispatched from continuation, emits `delegation.recovered` in `backend/tests/recovery.redispatch.test.ts`
- [X] T015 [P] [US1] DB-backed integration test: duplicate recovery pass is a no-op (`recovery_epoch`), no double side effects in `backend/tests/recovery.idempotent.test.ts`

### Implementation for User Story 1

- [X] T016 [US1] Add `wake(sessionId): Promise<WakeResult>` to the `AgentHarness` interface in `backend/src/fleet-executor/harness.ts`
- [X] T017 [US1] Implement `wake` in `AcpHarness` via ACP `session/load` (when `load_session` advertised) with `checkpoint_continuations` re-dispatch fallback in `backend/src/fleet-executor/acp-harness.ts`
- [X] T018 [US1] Implement idempotent recovery claim (`FOR UPDATE SKIP LOCKED` + `recovery_epoch` bump; already-completed/resumed short-circuit) in `backend/src/recovery/service.ts`
- [X] T019 [US1] Implement tiered restart recovery (durable → resume in place; ephemeral → re-dispatch fresh) in `backend/src/recovery/service.ts` per contracts/harness-wake.md
- [X] T020 [US1] Wire recovery at boot behind `RESUME_ON_RESTART`, replacing the unconditional fail in `recoverLifecycleState`, in `backend/src/opencode/process-manager.ts`
- [X] T021 [US1] Emit `session.resumed` / `delegation.recovered` / `delegation.recovered_failed` for every outcome; guarantee no delegation left silently failed, in `backend/src/recovery/service.ts`
- [ ] T022 [US1] Surface `resumed`/`recovered` status labels using existing delegation/agent status components in `web/src/hooks/useLoopStatus.ts` and the delegation status UI, covering loading/empty/success/error states with existing patterns

**Checkpoint**: US1 independently testable — restart resumes work; MVP complete

---

## Phase 4: User Story 2 - Secrets are brokered, short-lived, and never on disk (Priority: P2)

**Goal**: Every agent secret is broker-issued, scoped, env-only, revoked at teardown, and never written to the workdir.

**Independent Test**: Provision an agent → scan worktree/workdir/config for secret values (none, SC-002); tear down → credentials revoked and rejected.

### Tests for User Story 2

- [ ] T023 [P] [US2] DB-backed test: after provisioning, no secret value appears in worktree/config files (scan) in `backend/tests/credentials.no-disk.test.ts`
- [ ] T024 [P] [US2] DB-backed test: ephemeral teardown revokes credentials synchronously and rejects reuse in `backend/tests/credentials.revoke.test.ts`
- [ ] T025 [P] [US2] DB-backed test: durable rotation within ≤24h TTL without restart; non-rotatable/over-TTL flagged `risky` with event in `backend/tests/credentials.rotate.test.ts`

### Implementation for User Story 2

- [ ] T026 [P] [US2] Define `CredentialBroker` types (`IssuedCredential`, `CredentialKind`, scope) in `backend/src/credentials/types.ts`
- [ ] T027 [US2] Implement `issueForAgent`/`rotate`/`revoke`/`revokeAllForAgent` over the encrypted store (`crypto.ts`/`SECRET_ENCRYPTION_KEY`) + `brokered_credentials` in `backend/src/credentials/broker.ts` per contracts/credential-broker.md
- [ ] T028 [US2] Add the `node-cron` rotation job (≤24h TTL) and risky-credential flagging in `backend/src/credentials/broker.ts`
- [ ] T029 [US2] Inject broker env vars at spawn and REMOVE all secret/key writes from `writeConfigFiles`/config (env-only, FR-009) in `backend/src/opencode/process-manager.ts`
- [ ] T030 [US2] Replace the long-lived control-plane token with a broker-issued scoped token in `backend/src/opencode/process-manager.ts` and validate it in `backend/src/mcp/server.ts`
- [ ] T031 [US2] Emit `credential.issued|rotated|revoked|risk_flagged` events in `backend/src/credentials/broker.ts`
- [ ] T032 [US2] Add a risky-credential badge using existing status components in `web/src/components/` (agent/credential surface), handling the no-risk (empty) and load/error states consistently
- [ ] T058 [US2] Issue Gitea **scoped/derived** tokens (repo/capability-scoped, distinct from named-secret pass-through) in `backend/src/credentials/broker.ts` (FR-011)
- [ ] T059 [US2] Route assigned MCP-server secrets through the broker and stop writing their `env_vars` into `opencode.json`/config (env-only injection) in `backend/src/opencode/process-manager.ts` (FR-009, FR-011) — covered by the no-disk scan in T023
- [ ] T063 [US2] Route Prime's LLM calls through the control-plane proxy (no raw provider key) in `backend/src/prime-agent/llm-router.ts`, and add a test asserting the proxy is the **sole** raw-key holder and Prime stays within its enumerated action set + approval gates in `backend/tests/prime-proxy.test.ts` (FR-026, FR-027, SC-008)

**Checkpoint**: US1 + US2 both independently functional

---

## Phase 5: User Story 5 - A subverted agent cannot escape or exfiltrate (Priority: P2)

**Goal**: Two-dimension containment — scoped filesystem + default-deny egress via an unbypassable control-plane proxy under a gVisor-class sandbox.

**Independent Test**: From inside a runtime, out-of-dir write, secret/other-workspace read, and non-allowlisted connect all fail and are recorded; an allowlisted op succeeds (SC-007).

### Tests for User Story 5

- [ ] T033 [P] [US5] Isolation test: write outside the working directory is denied and emits `fs.denied` in `backend/tests/isolation.fs.test.ts`
- [ ] T034 [P] [US5] Isolation test: non-allowlisted host blocked (`egress.denied`), allowlisted host succeeds in `backend/tests/isolation.egress.test.ts`
- [ ] T035 [P] [US5] Isolation test: reading a secret path / another agent's workspace is denied in `backend/tests/isolation.secrets.test.ts`
- [ ] T065 [P] [US5] Boundary test: a simulated compromise inside the runtime container cannot read the primary container's secrets/filesystem nor a sibling agent's workspace/token in `backend/tests/isolation.container-boundary.test.ts` (SC-009)

### Implementation for User Story 5

- [ ] T061 [US5] Build the single configurable runtime image (`runtime-image/Dockerfile`) bundling operator-selected runtimes + per-process sandbox tooling, and the launcher service (`RuntimeLauncher`: `startAgent`/`stopAgent`/`health`, UID-isolated spawn, bearer-token auth) in `runtime-image/launcher/` per contracts/launcher.md (FR-023, FR-024, FR-025)
- [ ] T062 [US5] Switch the harness transport to **ACP over an authenticated TCP socket** to the launcher (backend connects out; bearer token) instead of spawning a child, with the HTTP adapter as the per-family fallback, behind `EGRESS_SANDBOX`, in `backend/src/acp/client.ts`, `backend/src/fleet-executor/acp-harness.ts`, and `backend/src/opencode/process-manager.ts` (FR-023). MUST preserve the US1 resume path (`wake`/`session/load`) across the transport swap — re-run T013–T015 over the socket transport.
- [ ] T066 [US5] Relocate ACP client-fs handling: serve `fs/read_text_file`/`fs/write_text_file` in the launcher against the Landlock-scoped workspace and remove the backend from the agent's fs path, in `runtime-image/launcher/` and `backend/src/acp/fs-handler.ts` (FR-025)

- [ ] T036 [P] [US5] Implement `EgressAllowlist` (`list`/`deriveDefaults` from capabilities+MCP assignments/`requestHost`→approval queue, default-deny) over `egress_allowlist` in `backend/src/proxy/egress.ts` per contracts/egress-allowlist.md
- [ ] T037 [US5] Implement the control-plane LLM proxy (validate broker proxy token, attach provider key server-side, forward/stream, emit `llm.proxied`) in `backend/src/proxy/llm-proxy.ts` per contracts/llm-proxy.md
- [ ] T038 [US5] Implement per-process isolation for each agent inside the runtime container — distinct UID, scoped working-dir via Landlock/mount namespace (no credential/other-workspace access), `no_new_privs` + seccomp — in the launcher (`runtime-image/launcher/`) and wired from `backend/src/opencode/process-manager.ts` behind `EGRESS_SANDBOX`; optionally run the runtime container itself under `runsc` (compose-level)
- [ ] T039 [US5] Enforce per-UID default-deny egress (no DNS / no raw outbound TCP; only route = the control-plane proxy) and block direct-to-provider egress, in `runtime-image/launcher/` + `backend/src/proxy/egress.ts`
- [ ] T040 [US5] Emit `egress.denied` / `fs.denied` on blocked attempts in the sandbox/proxy enforcement path in `backend/src/proxy/egress.ts`

**Checkpoint**: US1, US2, US5 independently functional — secrets brokered AND containment enforced

---

## Phase 6: User Story 3 - Durable agents provisioned on demand (Priority: P3)

**Goal**: Durable staff provisioned on first routed work and reclaimed after 10 min idle; identity/records preserved.

**Independent Test**: No durable runtime runs with no work (SC-004); routing work provisions ≤5s p95; 10-min idle reclaims to zero compute.

### Tests for User Story 3

- [ ] T041 [P] [US3] DB-backed test: with no routed work, no durable runtime is running in `backend/tests/lease.no-eager-boot.test.ts`
- [ ] T042 [P] [US3] DB-backed test: routing work provisions within readiness budget; identity/records unchanged in `backend/tests/lease.provision.test.ts`
- [ ] T043 [P] [US3] DB-backed test: 10-min idle reclaim emits `runtime.reclaimed` and frees compute in `backend/tests/lease.reclaim.test.ts`

### Implementation for User Story 3

- [ ] T044 [P] [US3] Implement `RuntimeLease` as a **process slot in the runtime container** (`acquire`/`touch`/`release`/`reclaimIdle`; concurrent acquire coalesces; queue work during provisioning; start the runtime container on first use, stop it when empty) over `runtime_leases` in `backend/src/runtime/lease.ts` per contracts/runtime-lease.md
- [ ] T045 [US3] Remove eager durable-agent spawning from `initialize()`; on work routing, acquire a lease that asks the launcher to start the agent (behind `LAZY_PROVISIONING`) in `backend/src/opencode/process-manager.ts` and the dispatcher (`backend/src/dispatch.ts`)
- [ ] T046 [US3] Add the `node-cron` idle-reclaim sweep (≥10 min `last_activity_at`) tearing down the sandbox while preserving DB identity in `backend/src/runtime/lease.ts`
- [ ] T047 [US3] Map lease lifecycle onto `agents.state` and emit `runtime.leased`/`runtime.reclaimed` in `backend/src/runtime/lease.ts`

**Checkpoint**: US1, US2, US5, US3 all independently functional

---

## Phase 7: User Story 4 - One coherent, replayable session timeline (Priority: P3)

**Goal**: The operator/Prime can view any session as one ordered timeline merged across stores and read bounded slices without loading full history.

**Independent Test**: Reconstruct a session's full ordered timeline from one interface; request `last N`/a range and confirm a bounded query (SC-005).

### Tests for User Story 4

- [ ] T048 [P] [US4] DB-backed test: merged timeline orders events + messages + delegation traces + checkpoints by `seq` in `backend/tests/session-timeline.merge.test.ts`
- [ ] T049 [P] [US4] DB-backed test: bounded slice (`last N` / range) returns without materializing full history in `backend/tests/session-timeline.slice.test.ts`

### Implementation for User Story 4

- [ ] T050 [US4] Extend `SessionStore.getSession`/`getEvents` to merge `thread_messages`, `delegations.trace`, and `checkpoint_continuations` into the ordered timeline in `backend/src/session/store.ts`
- [ ] T051 [US4] Expose a session timeline + bounded-slice read endpoint in `backend/src/routes/` (new route) wired in `backend/src/app.ts`
- [ ] T052 [US4] Build the operator session-timeline view consuming bounded slices in `web/src/pages/prime/LoopPage.tsx` (or the global inspector window), with loading, empty, success, and error states reusing existing UI patterns

**Checkpoint**: All user stories independently functional

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T053 [P] Document new feature flags, runtime model, and broker/proxy ops in `README.md` and `HANDOFF.md`
- [ ] T054 Review audit trails and observability completeness across all new `runtime_events` types
- [ ] T055 Regression gate: run full `npm test` with all flags OFF and confirm legacy paths pass unchanged (SC-006)
- [ ] T060 Add a threshold-measurement harness enforcing SC-001 (≥99% of N in-flight delegations resume, zero silent loss) and SC-004 (provisioning p95 ≤5s / p99 ≤10s) in `backend/tests/perf.restart-provision.test.ts`; failing thresholds fail the gate
- [ ] T056 Run `specs/024-managed-agent-runtime/quickstart.md` validation across all stories
- [ ] T057 After validation, remove the legacy fail-and-requeue and eager-boot paths and retire their flags (FR-017 cleanup) in `backend/src/opencode/process-manager.ts`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories (schema + session substrate)
- **US1 (Phase 3, P1)**: Depends on Foundational (uses `wake`, `recovery_epoch`, SessionStore)
- **US2 (Phase 4, P2)**: Depends on Foundational. Co-developed with US5: the broker (T027) and the control-plane proxy (T037) are mutually dependent (proxy validates the broker's token; Prime/agents call the proxy), and Prime-via-proxy (T063) needs the proxy — build the broker + proxy together
- **US5 (Phase 5, P2)**: Depends on Foundational; co-developed with US2 (broker + proxy). Adds the runtime image + launcher (T061/T062) and per-process isolation; the runtime container is the new home for agents. **Because T062 swaps the harness transport, the US1 resume path (T016–T021) MUST be re-validated over the ACP socket once T062 lands** — wake works against both stdio (MVP) and socket transports
- **US3 (Phase 6, P3)**: Depends on Foundational **and** on the US5 launcher (T061/T062), since the slot-lease provisions agents via the launcher; integrates with US1 `wake` on re-acquire but independently testable
- **US4 (Phase 7, P3)**: Depends on Foundational SessionStore core; independent of US1–US3, US5
- **Polish (Phase 8)**: Depends on all targeted stories complete

### Within Each User Story

- Tests written first and FAIL before implementation
- Types/models before services; services before endpoints/wiring; events + UX states before closing
- Story complete and independently testable before the next priority

### Parallel Opportunities

- Setup: T001, T002, T003 in parallel
- Foundational migrations: T005, T006, T007, T008 in parallel (T004 touches `runtime_events`; T009/T010 follow)
- Each story's test tasks ([P]) run together before its implementation
- After Foundational, US2, US4 can proceed in parallel with US1; US5 follows US2; US3 anytime after Foundational

---

## Parallel Example: User Story 1

```bash
# Tests first (parallel):
Task: "Integration test durable resume in backend/tests/recovery.resume.test.ts"
Task: "Integration test ephemeral re-dispatch in backend/tests/recovery.redispatch.test.ts"
Task: "Integration test idempotent recovery in backend/tests/recovery.idempotent.test.ts"

# Then implementation (harness change T016 → AcpHarness T017 → recovery T018/T019 → wiring T020)
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational (schema + SessionStore) → 3. Phase 3 US1
4. **STOP and VALIDATE**: restart-resume works, no silent loss (SC-001) → demo MVP

### Incremental Delivery

1. Setup + Foundational → substrate ready
2. US1 (P1) → restart resilience (MVP) → demo
3. US2 (P2) → brokered secrets → demo
4. US5 (P2) → containment (with US2's proxy token) → demo
5. US3 (P3) → cattle provisioning → demo
6. US4 (P3) → unified timeline → demo
7. Polish → regression gate + legacy path removal

### Notes

- Every story ships behind its feature flag; legacy paths remain until T057 cleanup (FR-017)
- All new lifecycle moments emit `runtime_events` (FR-015) — verify in T054
- Commit after each task or logical group
