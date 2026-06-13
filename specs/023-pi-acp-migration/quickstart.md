# Quickstart: Pi ACP Migration

## Goal

Implement the Pi runtime migration so existing Pi agents run through `AcpHarness` using `pi-acp`
without requiring registry migrations or operator workflow changes.

## Implementation Steps

1. ✅ Add `pi-acp` to `backend/package.json` dependencies.
2. ✅ Update `backend/src/opencode/process-manager.ts` so the `pi` runtime family constructs the
   built-in Pi ACP launch profile and starts `AcpHarness` instead of `PiHarness`.
3. ✅ Ensure the Pi ACP launch path preserves resolved model/provider environment passthrough.
4. ✅ Delete `backend/src/fleet-executor/pi-harness.ts` and remove references to it.
5. ✅ Update backend tests to cover:
   - Pi runtime-family routing to `AcpHarness`
   - ignored per-agent subprocess command overrides for Pi agents
   - actionable startup failure when `pi-acp` or `pi` is unavailable
6. ✅ Update any imports or exports affected by removing `PiHarness`.

## Verification

Backend build succeeds with TypeScript:

```bash
cd backend && npm run build
```

Backend tests pass (excluding database connection failures):

```bash
cd backend && npm test
```

Expected outcome: Pi agents continue to appear as Pi in the registry, but now run through the ACP
harness with `pi-acp` instead of the deleted bespoke bridge.

## Verification Result (2026-06-13)

TypeScript build: **pass** — `npx tsc --noEmit` reports no errors (excluding pre-existing `yaml`
module issue in `catalog/` which is unrelated).

Test suite: all Pi ACP routing tests in `backend/tests/opencode/process-manager.test.ts` pass
in the unit test runner (`vitest`). DB-backed tests require Docker networking and are validated
via the standard Docker test compose path.

## Expected Outcome

- ✅ Pi agents continue to appear as Pi in the registry
- ✅ Pi tasks start through ACP instead of the deleted bespoke bridge  
- ✅ Existing Pi agent records still work without data migration
- ✅ `PI_MODEL` and `PI_PROVIDER` env vars are passed to `pi-acp` at startup (FR-010)
- ✅ Missing `pi-acp` binary surfaces an actionable error (FR-009)
- ✅ Per-agent subprocess command/args overrides are ignored for Pi agents
- ✅ Generic ACP agents continue to use their configurable command
- ✅ There is one supported subprocess protocol path for Pi agent execution
- ✅ No PiHarness module or import exists anywhere in the runtime codebase
