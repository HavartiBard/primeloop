# Quickstart: Validating Managed-Agent Runtime Alignment

How to exercise and verify each user story once implemented. Backend tests run under
Vitest with a DB (`TEST_DATABASE_URL`); see `README.md` for the disposable test DB.

## Validation Status (as of 2026-06-04)

| Story | DB tests | Status |
|-------|----------|--------|
| US1 — restart resume | `tests/recovery.test.ts` (5) | ✅ Green |
| US2 — credential broker | `tests/credentials.test.ts` (7), `credentials-lifecycle.test.ts` (4) | ✅ Green |
| US3 — on-demand provisioning | `tests/runtime-lease.test.ts` (2), `lease.*.test.ts` (3) | ✅ Green |
| US4 — unified session timeline | `tests/session-store.test.ts` (8+) | ✅ Green |
| US5 — containment | egress `tests/egress.test.ts` (5) | ⚠️ Partial — kernel sandbox (T038/T039), isolation tests (T033–T035/T065), and ACP-over-TCP transport need a running runtime container |
| SC-001/SC-004 thresholds | `tests/perf.restart-provision.test.ts` (2) | ✅ Green |
| SC-006 regression gate | Full suite, all flags off | ✅ 483+ passed, no new failures |

## Prerequisites

```sh
cd backend
npm install
npm run test:db:up        # disposable Postgres on :55432
```

Feature flags (default off → legacy behavior; turn on per phase):
`RESUME_ON_RESTART`, `LAZY_PROVISIONING`, `CREDENTIAL_BROKER`, `EGRESS_SANDBOX`.

For the topology phases (US5/US3), build the runtime container and generate the compose:

```sh
scripts/setup.sh --runtimes opencode,pi   # builds the single configurable runtime image
                                           # + docker-compose (primary + runtime container)
docker compose up -d                       # primary + runtime container on a private network
```

## US1 — In-flight work survives a restart (P1)

1. Start ≥2 delegations to durable agents; let them reach in-flight.
2. Kill and restart the backend process mid-flight.
3. **Expect**: each delegation emits `session.resumed` (durable) and completes without
   re-issue; any unresumable one emits `delegation.recovered` / `recovered_failed`.
   No delegation left silently failed (SC-001).
4. Idempotency: trigger recovery twice; confirm `recovery_epoch` prevents double work.

```sh
npm test -- recovery
```

## US2 — Brokered secrets never on disk (P2)

1. Provision an agent.
2. **Expect**: `grep -r` of the agent worktree/workdir/config finds zero secret values
   (SC-002); provider access works only via the LLM proxy token.
3. Tear the agent down; confirm `credential.revoked` and the token is rejected (401).
4. **Sole key holder (SC-008)**: scan the runtime container and Prime's config/env — no
   raw provider key is present anywhere but the proxy; Prime and subagents reach the
   provider only via the proxy.

```sh
npm test -- credentials prime-proxy
```

## US5 — Containment of a subverted agent (P2)

Run the isolation tests against an agent in the runtime container (per-process
UID/Landlock/egress; launched via the launcher over the authenticated ACP socket):

1. Attempt write outside the working dir → denied, `fs.denied` recorded.
2. Attempt read of a secret path / another agent's workspace → denied.
3. Attempt connect to a non-allowlisted host → blocked, `egress.denied` recorded.
4. Attempt an allowlisted host → succeeds.
5. **Container boundary (SC-009)**: from inside the runtime container, attempt to reach
   the primary container's secrets/filesystem and a sibling agent's workspace/token →
   all fail (the container wall + per-process UID isolation both hold).

```sh
npm test -- isolation
```

## US3 — On-demand provisioning + idle reclaim (P3)

1. Boot the system with no routed work; **expect** no durable runtime processes running
   (SC-004), agents in `idle`/no-lease state.
2. Route work to an idle durable agent; **expect** provisioning ≤5s p95 to accept, then
   `runtime.leased`, identity/records unchanged.
3. Leave the agent idle 10 min; **expect** `runtime.reclaimed` and zero idle compute.

```sh
npm test -- lease
```

## US4 — Unified, sliceable session timeline (P3)

1. For a session with many events, request the full ordered timeline via `SessionStore`.
2. Request `{ last: 20 }` and a `{ from, to }` range; **expect** a bounded query that
   returns only the slice without materializing full history (SC-005).

```sh
npm test -- session-store
```

## Regression gate (SC-006)

With all flags off, the full suite MUST pass unchanged (legacy paths intact):

```sh
npm test
```
