# Implementation Plan: Pi ACP Migration

**Branch**: `023-pi-acp-migration` | **Date**: 2026-06-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/023-pi-acp-migration/spec.md`

## Summary

Retire the bespoke `PiHarness` subprocess bridge and route all Pi agent execution through the
existing ACP harness path using a built-in `pi-acp` launch profile. The change stays transparent to
existing Pi agent records: the registry continues to expose `pi` as a distinct runtime family, but
`OpenCodeProcessManager` maps that family onto `AcpHarness` with a fixed command strategy,
preserving model/provider environment passthrough, cancellation behavior, and downstream task /
delegation tracking.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js backend (ESM with `.js` import specifiers)

**Primary Dependencies**: existing `@agentclientprotocol/sdk`, new runtime dependency `pi-acp`,
`pg`, Node `child_process`, existing fleet executor / process manager / registry modules

**Storage**: PostgreSQL-backed agent registry and runtime events; no schema change expected

**Testing**: Vitest backend test suite, especially `backend/tests/opencode/process-manager.test.ts`,
`backend/tests/fleet-executor/acp-harness.test.ts`, and replacement coverage for removed
`backend/tests/fleet-executor/pi-harness.test.ts`

**Target Platform**: Linux self-hosted server runtime where `pi` is available on PATH

**Project Type**: Web application monorepo with backend-focused infrastructure change

**Performance Goals**: Pi startup and prompt dispatch remain within existing ACP harness behavior;
no perceptible regression in task start latency or streaming responsiveness for Pi runs

**Constraints**:
- Pi agents keep the `pi` runtime family for operator clarity and backward compatibility
- Pi agent startup MUST ignore per-agent subprocess command/argument overrides
- Pi model/provider resolution continues to flow through existing environment passthrough
- No mandatory database migration or per-agent config rewrite
- Only the requested backend verification should be run during implementation

**Scale/Scope**: Single-tenant control plane; migration affects Pi-backed local subprocess agents and
related backend tests only

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code quality**: Remove the bespoke Pi-only bridge and reuse the existing ACP harness boundary,
  which simplifies the runtime path rather than adding a parallel abstraction. Keep runtime-family
  selection explicit in `process-manager.ts`, delete dead Pi harness code, and cover the changed
  launch mapping with focused backend tests.
- **YAGNI**: One new dependency (`pi-acp`) is justified because the feature's purpose is to replace
  custom glue with a maintained ACP adapter. No registry redesign, no new runtime family, and no
  speculative per-agent override compatibility layer are introduced.
- **SRE readiness**: Pi startup failures continue to surface as actionable harness/process-manager
  errors. ACP session lifecycle, cancellation, and runtime event recording remain on the existing
  operational path already used by ACP agents. Rollback remains straightforward: revert the Pi→ACP
  mapping and dependency change.
- **UX consistency**: Operators still create and run Pi agents the same way. Terminology remains
  stable (`pi` runtime family), and no new UI or operator repair workflow is introduced.
- **Visual polish**: No UI changes; existing surfaces remain untouched.
- **Primeloop architecture constraints**: Prime remains the sole steering interface, durable records
  stay authoritative, per-agent isolation still relies on existing worktree/workspace boundaries,
  and single-tenant scope is unchanged.

No constitutional violations identified.

## Project Structure

### Documentation (this feature)

```text
specs/023-pi-acp-migration/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── pi-runtime-launch.md
│   └── process-manager-routing.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── package.json                         # MODIFY: add pi-acp runtime dependency
├── src/
│   ├── acp/
│   │   └── client.ts                   # existing ACP subprocess client
│   ├── fleet-executor/
│   │   ├── acp-harness.ts              # existing ACP harness reused for Pi
│   │   ├── harness.ts                  # existing AgentHarness contract
│   │   └── pi-harness.ts               # DELETE
│   └── opencode/
│       └── process-manager.ts          # MODIFY: map pi runtime family to ACP-backed launch profile
└── tests/
    ├── fleet-executor/
    │   ├── acp-harness.test.ts         # existing ACP harness tests
    │   └── pi-harness.test.ts          # DELETE or replace coverage
    └── opencode/
        └── process-manager.test.ts     # MODIFY: verify Pi routing and launch behavior

AGENTS.md                               # MODIFY: point SPECKIT marker at this plan
```

**Structure Decision**: Backend-only infrastructure migration. Reuse the existing ACP client and
harness modules; limit implementation changes to dependency management, Pi runtime selection in
`process-manager.ts`, and tests that currently exercise the deleted Pi-specific harness.

## Complexity Tracking

No constitutional violations to justify.

## Phase 0: Research

### Research Goals

Resolve the design details needed to implement the migration without introducing speculative
configuration surfaces:

1. Confirm the dependency strategy for `pi-acp` in this repository.
2. Confirm how model/provider environment variables reach `pi-acp` through the existing ACP launch
   path.
3. Confirm how Pi runtime-family routing should behave for existing registry rows and ignored
   per-agent command overrides.
4. Confirm deletion / test migration scope for `PiHarness`.

### Research Output

See [research.md](research.md) for decisions, rationale, and alternatives considered.

## Phase 1: Design & Contracts

### Data Model

See [data-model.md](data-model.md) for the runtime entities affected by this migration. No database
schema change is planned; the design focuses on runtime records, launch profiles, and invariants.

### Contracts

- [contracts/pi-runtime-launch.md](contracts/pi-runtime-launch.md) — built-in Pi ACP launch profile
  and environment contract
- [contracts/process-manager-routing.md](contracts/process-manager-routing.md) — runtime-family to
  harness selection contract and override handling

### Quickstart

See [quickstart.md](quickstart.md) for the implementation sequence and verification checklist.

## Phase 2: Implementation Strategy (COMPLETE)

1. ✅ Add `pi-acp` as a backend runtime dependency.
2. ✅ Update Pi startup routing in `backend/src/opencode/process-manager.ts` so `pi` agents launch via
   `AcpHarness` using the fixed Pi ACP launch profile.
3. ✅ Preserve resolved model/provider environment passthrough for the Pi ACP process.
4. ✅ Delete `backend/src/fleet-executor/pi-harness.ts` and remove or replace tests that target the
   retired harness directly.
5. ✅ Add or update backend tests covering Pi runtime-family routing, ignored per-agent command
   overrides, and startup failure behavior when the Pi ACP command is unavailable.

## Post-Design Constitution Check

- **Code quality**: Design stays simpler than today by removing a bespoke harness and consolidating
  Pi on the ACP path already maintained by the codebase.
- **YAGNI**: The only new permanent surface is the `pi-acp` dependency plus a small built-in launch
  mapping; no additional registry fields or override compatibility behavior were added.
- **SRE readiness**: Existing ACP lifecycle handling remains the source of runtime diagnostics and
  cancellation behavior. The design explicitly preserves actionable startup failures for missing
  `pi-acp` / `pi` executables.
- **UX consistency**: Operator-facing Pi behavior and terminology remain unchanged.
- **Visual polish**: No UI impact.
- **Primeloop architecture constraints**: No effect on Prime steering, durable records, isolation,
  or tenancy.

Post-design check passes.
