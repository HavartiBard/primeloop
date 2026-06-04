# Quickstart: Validating Managed-Agent Runtime Alignment

How to exercise and verify each user story once implemented. Backend tests run under
Vitest with a DB (`TEST_DATABASE_URL`); see `README.md` for the disposable test DB.

## Prerequisites

```sh
cd backend
npm install
npm run test:db:up        # disposable Postgres on :55432
```

Feature flags (default off → legacy behavior; turn on per phase):
`RESUME_ON_RESTART`, `LAZY_PROVISIONING`, plus broker/proxy enablement.

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

```sh
npm test -- credentials
```

## US5 — Containment of a subverted agent (P2)

Run the isolation test from inside a provisioned sandbox:

1. Attempt write outside the working dir → denied, `fs.denied` recorded.
2. Attempt read of a secret path / another agent's workspace → denied.
3. Attempt connect to a non-allowlisted host → blocked, `egress.denied` recorded.
4. Attempt an allowlisted host → succeeds.

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
