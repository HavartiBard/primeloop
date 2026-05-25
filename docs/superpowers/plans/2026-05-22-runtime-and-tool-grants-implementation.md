# Runtime And Tool Grants Implementation Plan

> Source specs:
> - `specs/002-agent-lifecycle-and-sandbox/spec.md`
> - `specs/009-mcp-registry/spec.md`

**Date:** 2026-05-22

**Goal:** Implement the Phase A non-Prime runtime and layered tooling model so ACP can run durable staff and short-lived ephemerals with persisted lifecycle state, least-privilege tool grants, and DB-backed recovery.

**Architecture:** Prime remains native. Non-Prime workers are concrete `agents` rows managed by the harness. Durable agents are supervised long-lived local processes. Ephemerals are short-lived persisted agent rows created per task. Every run resolves a persisted `Tool Grant` from routing capability, capability profile, task scope, approval state, and provider availability. Runtime config exposes only granted control-plane primitives and provider adapters.

**Tech Stack:** TypeScript ESM, Node.js 20+, PostgreSQL via `pg`, existing fleet dispatcher/process manager, MCP control-plane server, local filesystem worktrees, Vitest.

## Operating Model

This plan is intended to be executed through **Gitea issue slices delegated to shell-driven local Pi agents**.

The execution loop for every slice is:

1. Create one scoped Gitea issue for the slice.
2. Ensure the issue contains:
   - objective
   - validation baseline
   - allowed files
   - required verification command(s)
   - completion signal requirements
3. Dispatch a local Pi agent against that single issue scope.
4. Pi agent executes through the shell, updates the Gitea issue as it works, and sends a completion signal by:
   - posting final status on the issue
   - linking its branch/PR
   - marking validation and verification results
5. I review the resulting diff/PR.
6. If fixes are needed, I open or update follow-up issue instructions and dispatch another Pi agent on the same slice or PR.
7. I merge the PR only when the slice satisfies the spec and verification expectations.

Pi agents should be treated as execution workers, not as autonomous deciders of architecture. Architecture stays locked by specs `002` and `009` plus this plan.

## Execution Principle

Every implementation slice below must follow the same order:

1. **Validate existing**: prove what ACP already does today, add/adjust tests that lock current baseline, and identify places where new behavior would otherwise regress existing flows.
2. **Implement**: make the smallest coherent set of code and schema changes for the slice.
3. **Verify**: run slice-specific verification immediately, then rerun any impacted baseline checks.

No slice should assume the previous system is blank. Each slice should explicitly confirm current behavior before replacing or extending it.

Each slice must also be narrow enough that a shell-driven Pi agent can execute it cleanly from a single issue without needing to infer unrelated architecture or cross-slice policy.

## Repo Baseline

Relevant existing surfaces:

- `backend/src/db.ts`
- `backend/src/registry.ts`
- `backend/src/runtime.ts`
- `backend/src/fleet-executor/dispatcher.ts`
- `backend/src/fleet-executor/harness.ts`
- `backend/src/opencode/process-manager.ts`
- `backend/src/mcp/service.ts`
- `backend/src/mcp-registry.ts`
- `backend/src/routes/agents.ts`
- `backend/tests/`

Current important facts to preserve while evolving:

- Prime is already represented by native `prime_agent_*` tables, not as a normal worker identity
- `delegations.capability` already exists and should remain the Phase A home of the **routing capability**
- the process manager already writes runtime config files and injects assigned MCP servers
- the control-plane MCP service already exposes concrete tool names such as `delegate_to_agent`, `request_approval`, `update_work_item`, and `resolve_approval`

## File Map

Likely files touched across the plan:

- `backend/src/db.ts`
- `backend/src/registry.ts`
- `backend/src/runtime.ts`
- `backend/src/fleet-executor/dispatcher.ts`
- `backend/src/fleet-executor/result-router.ts`
- `backend/src/opencode/process-manager.ts`
- `backend/src/mcp/service.ts`
- `backend/src/mcp-registry.ts`
- `backend/src/routes/agents.ts`
- new runtime/tooling policy modules under `backend/src/`
- matching tests under `backend/tests/`

## Slice 1: Schema And Persistence Foundation

**Objective:** Add the minimum persisted model required by specs `002` and `009`.

**Issue shape:** One Gitea issue covering only schema/persistence additions and related tests.

**Validate existing**

- Confirm current `agents`, `agent_runtime_configs`, `mcp_servers`, `agent_mcp_assignments`, and `delegations` behavior with DB-backed tests.
- Lock current assumptions that Prime is not a worker row and that `delegations.capability` is the routing label.
- Capture how current runtime config generation uses `agent_mcp_assignments`.

**Implement**

- Extend `agents` with Phase A lifecycle fields:
  - `tier`
  - `role`
  - `state`
  - `persona_file`
- Extend `agent_runtime_configs` with policy linkage fields such as:
  - `capability_profile_id`
  - optional defaults/config for runtime grant resolution
- Add persisted policy/grant structures:
  - `capability_profiles`
  - `capability_bundle_adapters` or equivalent mapping table
  - `tool_grants`
- Keep migrations idempotent and additive.

**Verify**

- DB migration tests pass.
- Existing registry and agent CRUD tests still pass or are updated intentionally.
- New persistence tests prove rows can be inserted/read for durable and ephemeral agents, capability profiles, and tool grants.

## Slice 2: Agent Lifecycle State And Recovery

**Objective:** Make the worker lifecycle in `002` real without breaking current agent startup.

**Issue shape:** One Gitea issue covering lifecycle persistence, recovery behavior, and related tests only.

**Validate existing**

- Confirm how the process manager currently prepares worktrees, writes config files, and starts managed local agents.
- Confirm current dispatcher behavior for queued delegations and current failure paths.
- Lock current harness interfaces with tests before changing lifecycle semantics.

**Implement**

- Add lifecycle transitions for non-Prime agents:
  - `provisioning -> ready -> busy -> idle/retiring -> terminated`
  - `* -> error`
- Teach the process manager and dispatcher to persist state transitions.
- Implement harness restart reconciliation for durable agents.
- Mark interrupted runs/delegations explicitly failed on recovery.
- Keep Prime outside this lifecycle system.

**Verify**

- Durable agent restart/recovery tests pass.
- Interrupted in-flight work is marked failed rather than left hanging.
- Existing process-manager startup behavior still works for currently managed local agents.

## Slice 3: Capability Profiles And Tool Grant Resolution

**Objective:** Implement the layered tooling model in a way that extends current `capabilities` and MCP assignment logic.

**Issue shape:** One Gitea issue covering policy resolution, persistence, and tests for grants only.

**Validate existing**

- Confirm current use of `agent.capabilities` for routing.
- Confirm current control-plane tool list and how runtime config writes all primitives and assigned MCP servers.
- Lock current behavior around provider selection and MCP assignment reads.

**Implement**

- Introduce explicit Phase A concepts in code:
  - `routing capability`
  - `tooling capability bundle`
  - `provider adapter`
  - `tool grant`
- Implement resolution order from spec `009`:
  - deny rules
  - task narrowing
  - approval state
  - capability profile
  - environment/provider availability
  - health/fallback
- Persist resolved grants per run.
- Preserve `delegations.capability` as the routing label.

**Verify**

- Tests prove routing capability and tooling bundles are distinct.
- Tests prove the same routing capability can resolve to different tool grants by role/task.
- Tool grants are persisted with inclusion/exclusion reasons.

## Slice 4: Control-Plane Primitive Filtering

**Objective:** Make control-plane primitives part of the grant instead of globally visible by default.

**Issue shape:** One Gitea issue covering primitive mapping, config filtering, auth alignment, and related tests only.

**Validate existing**

- Confirm which control-plane tools exist today and which are effectively Prime-only by policy or capability.
- Lock current concrete tool names:
  - `delegate_to_agent`
  - `request_peer_review`
  - `request_approval`
  - `update_work_item`
  - `resolve_approval`
- Confirm server-side authorization behavior in `mcp/service.ts`.

**Implement**

- Add canonical primitive-to-current-tool mapping.
- Filter runtime config to include only granted control-plane primitives for a run.
- Keep server-side authorization as a second enforcement layer.
- Explicitly prevent Prime-only primitives from entering non-Prime grants.

**Verify**

- Runtime config no longer exposes the full control-plane tool set to every worker.
- Non-granted primitives are absent from config and still rejected server-side if invoked directly.
- Prime-only primitives never appear in non-Prime grants.

## Slice 5: Durable Staff Bootstrap

**Objective:** Bootstrap Architect, SRE, and DevOps as durable workers with stable identity and role-default capability profiles.

**Issue shape:** One Gitea issue covering bootstrap/reconciliation behavior and tests only.

**Validate existing**

- Confirm current agent registration/update flow and process-manager sync behavior.
- Confirm no duplicate local agent rows are created on restart today.

**Implement**

- Create idempotent bootstrap logic for durable staff.
- Assign:
  - persistent identity
  - role
  - persona file
  - capability profile
  - worktree/runtime config linkage
- Reconcile profile/persona changes without identity churn.

**Verify**

- Re-running bootstrap does not duplicate agents.
- Durable staff come back after restart with the same identities and updated profiles.
- Existing local managed-agent behavior remains functional.

## Slice 6: Ephemeral Template Spawn Path

**Objective:** Create short-lived persisted ephemeral workers from templates, with narrow task-scoped grants.

**Issue shape:** One Gitea issue covering template instantiation, ephemeral lifecycle, and tests only.

**Validate existing**

- Confirm current delegation flow from Prime into `work_items` and `delegations`.
- Confirm current dispatcher expectations around target `agent_id`.
- Lock current prompt/task construction behavior so the spawn path can be extended safely.

**Implement**

- Define template-to-agent instantiation flow:
  - select template
  - create ephemeral `agents` row
  - assign role/tier/state/persona/profile
  - resolve task-specific tool grant
  - provision worktree/runtime config
  - run task
  - retire/terminate and clean up
- Persist tool grant and teardown outcome.

**Verify**

- A single ephemeral task can run end-to-end from row creation to termination.
- Ephemeral workers get narrower grants than durable staff by default.
- Terminated ephemerals remain queryable for audit.

## Slice 7: Integration Hardening

**Objective:** Prove the slices work together as one coherent runtime.

**Issue shape:** One Gitea issue covering cross-slice hardening, regression coverage, and final integration verification.

**Validate existing**

- Re-run baseline agent CRUD, MCP registry, Prime delegation, and dispatcher tests.
- Confirm current room/work item/delegation views still render expected runtime data.

**Implement**

- Close integration gaps:
  - reconcile tool-grant writes with runtime config generation
  - ensure result routing and runtime events include enough grant/lifecycle metadata
  - align any UI/API contracts that read agent state or assignments

**Verify**

- Full backend test suite for impacted areas passes.
- At least one durable-worker path and one ephemeral-worker path are exercised in integration tests.
- Recovery, scoping, and approval-gated grant behavior are all covered.

## Issue Slicing Guidance

When this plan is broken into Gitea issues, create one issue per slice above, not one issue per table or file. Each issue should include:

- the validation baseline to confirm first
- the exact spec sections it implements
- the files allowed to change
- the verification command(s) for that slice
- the expected completion signal back to the control operator/reviewer
- the required PR contents: summary, verification result, known gaps, and links back to the issue

Each issue should be scoped so a shell-driven Pi agent can complete it without needing to modify files outside the slice unless the issue explicitly allows it.

## Pi-Agent Dispatch Contract

Every Pi-agent issue should instruct the worker to:

1. Read only the spec sections and code paths relevant to the issue.
2. Validate current behavior before making changes.
3. Keep edits inside the issue's allowed files unless the issue is explicitly expanded.
4. Run the required verification command(s) and report exact results.
5. Update the Gitea issue with:
   - what was validated
   - what changed
   - verification status
   - branch name
   - PR link
6. Emit a clear completion marker in the issue comment, for example:
   - `PI TASK COMPLETE`
   - `Issue updated`
   - `PR ready for review`

## Review And Merge Contract

After a Pi agent signals completion:

1. I review the PR against the issue scope, the implementation plan, and specs `002` and `009`.
2. If changes are needed, I do not merge.
3. Instead, I add review feedback and dispatch another Pi agent with a narrow follow-up issue or explicit PR-fix instructions.
4. I merge only when:
   - scope is respected
   - validation baseline was checked
   - verification passed or any failure is explicitly understood and accepted
   - the slice meaningfully satisfies its spec obligations

## Recommended Execution Order

1. Slice 1: Schema And Persistence Foundation
2. Slice 2: Agent Lifecycle State And Recovery
3. Slice 3: Capability Profiles And Tool Grant Resolution
4. Slice 4: Control-Plane Primitive Filtering
5. Slice 5: Durable Staff Bootstrap
6. Slice 6: Ephemeral Template Spawn Path
7. Slice 7: Integration Hardening

## Recommended Issue Order

Create Gitea issues in the same order as the execution slices above. Do not open Pi-agent execution on later slices until the earlier dependency slice has been reviewed and accepted, except where an explicit parallelization decision is made.

## Exit Criteria

The plan is complete when:

- non-Prime worker identity/lifecycle is persisted
- durable staff survive restarts with stable identities
- ephemerals are concrete short-lived rows with audited teardown
- tool grants are persisted per run
- runtime config exposes only granted primitives and adapters
- control-plane authorization still enforces policy server-side
- Prime can delegate through the DB-backed path without becoming a worker row
