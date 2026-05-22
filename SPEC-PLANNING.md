# ACP Spec Planning Handoff

**Date**: 2026-05-21  
**Status**: Constitution written, backlog stubs created. Spec 002 drafted; 009 needs full capability/tooling treatment.

> Note: `HANDOFF.md` contains current dev state and UI direction. The room-centric workspace is the primary v1 operating surface. The circuit canvas remains in scope as a relationship view over work, with OpenSwarm-style live chat/tool interaction deferred to Phase 2. Align spec 011 to that split before writing the full spec.

## Decisions Locked (Do Not Re-Open Without Amending Constitution)

| # | Decision |
|---|---|
| 1 | **Spec shape**: Constitution + numbered backlog stubs + full spec per feature |
| 2 | **Tenancy**: Single-tenant, single-user, self-hosted. One instance = one operator. |
| 3 | **Horizon**: 12-month buildable target |
| 4 | **First full spec**: `002-agent-lifecycle-and-sandbox` |
| 5 | **Isolation runtime**: Two containers (db + harness). Per-agent isolation via worktrees + rlimits + scoped env inside harness. No per-agent containers. |
| 6 | **Durable staff**: Prime is its own singleton tier. Architect, SRE, and DevOps are always-on durable staff. Researcher, Tech Writer, QA, and Security are ephemerals. |
| 7 | **CoS pattern**: User directs through Prime only. The room workspace is the primary operating surface in v1. The circuit canvas is a secondary observational view with promoted actions. |
| 8 | **System of record**: ACP's DB coordinates runtime state; durable records are mirrored to gitea / jira / knowledge base where appropriate, not left in agent memory or session state |
| 9 | **Tooling model**: Tool access is layered as platform primitives -> capability bundles -> provider adapters -> per-run tool grants. Agents get the narrowest grant required for the task. |

## What Exists

- `.specify/memory/constitution.md` — written, full content, all principles
- `specs/001-prime-empty-fleet-graceful-delegation/` — existing full spec, in flight
- `specs/002-agent-lifecycle-and-sandbox/spec.md` — full draft spec written
- `specs/003-014/spec.md` — one-paragraph stubs each

## Next Step: Write Full Spec for 009

Flesh out `specs/009-mcp-registry/spec.md` so the tooling model becomes a first-class primitive rather than an MCP implementation detail.

**Key things to specify:**
- Platform primitives (`delegate`, `request_approval`, `publish_artifact`, etc.) as stable ACP contracts
- Capability bundles that map roles and task types to allowed actions
- Provider adapter model for MCP, HTTP, stdio, CLI, and future tool backends
- Per-run `Tool Grant` resolution at spawn time from role + task + approval state
- Capability profiles for Prime, durable staff, and ephemeral templates
- Deny-by-default scoping and escalation rules for direct infrastructure access
- How capability changes are reconciled onto long-lived durable agents
- How spec 010 credential leasing plugs into provider adapters and per-run grants

**User Stories to target:**
- P1: A spawned agent receives only the minimal tool grant needed for its task
- P2: Durable agents can be updated to new capability profiles without identity churn
- P3: ACP can swap a provider adapter behind a capability bundle without changing agent-facing task contracts

After the spec is written and user-approved, invoke `superpowers:writing-plans` to generate the implementation plan.

## OpenSwarm Reference (MIT, openswarm-ai/openswarm)

- `backend/apps/agents/` — agent lifecycle and streaming (closest analogue to our harness)
- `backend/apps/dashboard_layout/` — spatial canvas state persistence pattern for a later richer relationship view
- Uses git worktree per agent with `claude-agent-sdk` direct (no CLI wrapper)
- WebSocket streaming for real-time token output + state updates
- Strong Phase 2 inspiration only: live chat and tool access directly from the canvas
- Key ACP difference: ACP is hosted (Docker), uses DB as coordination layer, CoS is single entry point

## Backlog Order (Dependency-First)

```
001 ✓ Prime empty-fleet (in flight)
002   Agent lifecycle + sandbox        ← drafted
003   Durable staff bootstrap           (depends: 002)
004   CoS → ephemeral spawn flow        (depends: 002)
005   Ephemeral specialist templates    (depends: 003, 004)
006   Work item model + lanes           (parallel, no deps)
007   Gitea adapter                     (depends: 006)
008   Approval queue v2                 (depends: 006)
009   Capability registry + tool scoping (depends: 002) ← NEXT FULL SPEC
010   Credential broker                 (depends: 002)
011   Room + circuit relationship views (depends: 002-005) ← room workspace is v1 primary surface; live canvas interaction stays Phase 2
012   Knowledge artifacts               (depends: 007)
013   Grading + self-improvement        (depends: 003, 011, 012)
014   Cost ledger                       (depends: 002)
```
