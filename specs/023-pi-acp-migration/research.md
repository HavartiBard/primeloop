# Research: Pi ACP Migration

## Decision 1: Ship `pi-acp` as a backend runtime dependency

- **Decision**: Add `pi-acp` to `backend/package.json` as a runtime dependency and invoke it through
  the built-in Pi launch profile.
- **Rationale**: This avoids a fragile global-install prerequisite and avoids per-launch network
  dependency from `npx`. It keeps Pi startup deterministic for production and test environments.
- **Alternatives considered**:
  - **Global install / PATH requirement only**: Rejected because rollout would depend on external
    machine setup outside the repository's dependency contract.
  - **`npx -y pi-acp` at runtime**: Rejected because it adds per-launch download variability,
    startup latency, and offline failure modes.

## Decision 2: Reuse `AcpHarness` unchanged for Pi runtime execution

- **Decision**: Do not create a Pi-specific ACP harness. Route Pi agents into the existing
  `AcpHarness` using a fixed command of `pi-acp`.
- **Rationale**: `AcpHarness` already encapsulates ACP subprocess startup, session initialization,
  prompt dispatch, permission handling, cancellation, and task lifecycle integration. Reusing it is
  the simplest path and directly fulfills the goal of retiring bespoke Pi glue.
- **Alternatives considered**:
  - **Keep `PiHarness` alongside ACP**: Rejected because it preserves duplicate subprocess logic and
    defeats the migration goal.
  - **Create `PiAcpHarness` wrapper**: Rejected because it would only rename existing `AcpHarness`
    behavior without adding meaningful new capability.

## Decision 3: Preserve model/provider configuration through subprocess environment passthrough

- **Decision**: Continue resolving Pi model/provider in `process-manager.ts` and pass those values
  into the spawned ACP subprocess environment so `pi-acp` forwards them to `pi`.
- **Rationale**: This keeps current configuration ownership unchanged and uses the environment
  handling already supported by the ACP client subprocess launch path.
- **Alternatives considered**:
  - **Move model/provider selection into agent config fields specific to Pi ACP**: Rejected because
    it duplicates existing runtime-selection logic and would require unnecessary migration work.
  - **Hardcode provider/model defaults for Pi ACP**: Rejected because it would break existing agent
    configuration expectations.

## Decision 4: Keep `pi` as a distinct runtime family and map it transparently to ACP

- **Decision**: Preserve `runtime_family = 'pi'` in the registry and process-manager branching, but
  have that branch construct an ACP-backed launch profile internally.
- **Rationale**: This avoids registry churn, keeps operator-facing meaning intact, and localizes the
  migration to backend runtime startup code.
- **Alternatives considered**:
  - **Collapse Pi into generic `acp` runtime family**: Rejected because it would require registry
    migration, lose a useful operator-facing distinction, and broaden scope.
  - **Add a new `pi_acp` runtime family**: Rejected because it creates avoidable taxonomy churn for
    what is fundamentally an internal implementation change.

## Decision 5: Ignore per-agent command overrides for `pi` runtime-family agents

- **Decision**: `pi` runtime-family agents always use the built-in Pi ACP launch profile and ignore
  per-agent subprocess command/argument overrides.
- **Rationale**: This gives one deterministic supported path for Pi and prevents hidden agent-level
  drift from undermining migration safety or verification.
- **Alternatives considered**:
  - **Honor per-agent command overrides when present**: Rejected because it would make Pi launch
    behavior inconsistent across agents and reintroduce bespoke runtime support surface.
  - **Require converting all Pi agents to generic ACP config**: Rejected because it contradicts the
    no-mandatory-migration goal.

## Decision 6: No schema migration; update tests around process-manager routing

- **Decision**: Keep the database schema unchanged. Migrate test coverage from the deleted
  `PiHarness` onto `process-manager` and ACP-path tests.
- **Rationale**: The runtime-family mapping changes behavior without requiring new durable fields.
  The highest-value regression coverage is at the routing boundary where Pi now selects ACP.
- **Alternatives considered**:
  - **Add database flags for Pi ACP mode**: Rejected because existing `pi` runtime-family semantics
    are sufficient.
  - **Keep dedicated `pi-harness.test.ts` by introducing a thin compatibility wrapper**: Rejected
    because it would preserve a dead abstraction just for tests.
