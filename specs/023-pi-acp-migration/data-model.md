# Data Model: Pi ACP Migration

## Overview

This feature does not add or change database tables. It changes how existing runtime-facing records
and in-memory launch inputs are interpreted when an agent has the `pi` runtime family.

## Entities

### Pi Agent Registration

Represents an existing agent record identified as Pi-based in the registry.

**Relevant fields**
- `id`: Stable agent identifier used across dispatch, approvals, and runtime events
- `name`: Operator-facing label
- `runtime_family`: Must remain `pi` for this migration path
- `worktree_path`: Working directory used to launch the runtime
- `workspace_root`: Optional workspace boundary used by ACP file handling
- `config`: May contain generic subprocess command/argument settings, but those are ignored for Pi
  runtime-family agents after this migration

**Validation / invariants**
- Pi agent records remain valid without adding new fields
- Pi runtime-family agents always resolve to the built-in Pi ACP launch profile
- Per-agent subprocess command/argument overrides are not authoritative for Pi agents

### Pi Runtime Launch Profile

An internal, built-in launch definition used by the process manager when starting a Pi agent.

**Fields**
- `command`: `pi-acp`
- `args`: empty by default unless the implementation adds fixed built-in arguments later
- `cwd`: agent `worktree_path`
- `workspaceRoot`: `workspace_root` when present, otherwise `worktree_path`
- `env`: inherited process environment plus resolved Pi model/provider settings

**Validation / invariants**
- The launch profile is centrally defined in code, not per-agent data
- Startup must fail with an actionable error if `pi-acp` is unavailable
- The launch profile must preserve existing ACP harness lifecycle semantics

### Resolved Model/Provider Selection

The runtime configuration derived from existing provider/model resolution logic before agent launch.

**Fields**
- `model.id`: resolved model identifier for the Pi run
- `model.providerID`: resolved provider identifier for the Pi run
- `env passthrough`: process environment entries used by Pi ACP / Pi

**Validation / invariants**
- Resolution continues to use existing process-manager logic
- Values are passed into the launched runtime for each task start
- Changes to agent/provider configuration affect subsequent Pi runs without schema changes

### Pi Task Session

A single task execution for a Pi agent after the migration.

**Lifecycle**
1. Process manager recognizes `runtime_family = 'pi'`
2. Process manager constructs the built-in Pi ACP launch profile
3. `AcpHarness.start()` spawns `pi-acp`
4. ACP session initializes and prompts are dispatched
5. Task streams updates / completes / fails / cancels through existing ACP handling

**Validation / invariants**
- Downstream task/delegation tracking remains unchanged
- Cancellation uses the ACP cancel flow
- Failures before or during ACP startup settle the task with actionable errors

## Relationships

- A **Pi Agent Registration** produces one **Pi Runtime Launch Profile** per startup
- A **Pi Runtime Launch Profile** is parameterized by one **Resolved Model/Provider Selection**
- A **Pi Task Session** is the runtime execution produced by combining the agent registration, launch
  profile, and resolved model/provider settings

## State Transitions

### Runtime Routing State
- `pi registry record` → `built-in Pi ACP launch profile selected` → `ACP harness started`

### Task Execution State
- `ready` → `session started` → `streaming` → (`completed` | `failed` | `cancelled`)
