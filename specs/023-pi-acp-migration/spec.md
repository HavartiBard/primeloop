# Feature Specification: Pi ACP Migration

**Feature Branch**: `023-pi-acp-migration`

**Created**: 2026-06-03

**Status**: Draft

**Input**: User description: "Replace PiHarness with pi-acp"

## Overview

Pi agents currently rely on a bespoke runtime bridge that is unique to this codebase. That custom
bridge increases maintenance cost, duplicates capability that now exists in a standard ACP adapter,
and keeps Pi execution on a separate path from the ACP-native harness already supported by the
platform. This feature retires the bespoke Pi bridge and routes Pi agent execution through the
existing ACP harness path using the external `pi-acp` adapter.

The change is intended to be operationally transparent for existing Pi agents. Operators should be
able to continue registering and dispatching Pi agents without reworking normal task flows, while
the platform standardizes on one subprocess protocol path for Pi and other ACP-capable runtimes.

## Clarifications

### Session 2026-06-03

- Dependency strategy: The system ships with `pi-acp` as a runtime dependency so Pi agent startup
affects no external global install requirement and no per-launch network dependency.
- Environment strategy: Model and provider selection continue to come from the platform's resolved
agent model/provider configuration and are passed through to the spawned Pi ACP process using the
existing subprocess environment mechanism.
- Registry migration: Existing Pi agent records continue to work without mandatory data migration.
Runtime selection maps them to the ACP harness path transparently.
- Runtime taxonomy: The registry keeps a distinct `pi` runtime family for operator clarity and
backward compatibility, while the underlying execution path uses ACP with a well-known Pi ACP
command.
- Q: How should existing per-agent command/config overrides interact with Pi startup mapping? → A:
  Ignore per-agent command overrides for `pi` agents and always use the built-in Pi ACP launch
  profile.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run existing Pi agents without a bespoke bridge (Priority: P1)

An operator dispatches work to an existing Pi agent and the task completes through the same overall
platform workflow as before, but the execution now flows through the standard ACP harness path
instead of the bespoke Pi-specific bridge.

**Why this priority**: This is the primary purpose of the feature. If existing Pi agents cannot run
through the new path without operator-visible regression, the migration does not succeed.

**Independent Test**: Start a Pi agent that existed before the migration, dispatch a task to it,
and confirm the task starts, streams progress, supports cancellation, and reaches a terminal state
without using the retired Pi-specific bridge.

**Acceptance Scenarios**:

1. **Given** an existing Pi agent registration, **When** work is dispatched to that agent,
   **Then** the platform starts the agent through the ACP-based path and the task begins normally.
2. **Given** a Pi task running through the ACP-based path, **When** the agent emits progress,
   **Then** the operator sees the same class of task updates and completion behavior expected from a
   normal Pi run.

---

### User Story 2 - Keep Pi model and provider selection intact (Priority: P1)

An operator expects a Pi agent to keep honoring the configured model and provider for that agent.
After the migration, the selected runtime path still applies those settings so the agent runs with
the intended configuration.

**Why this priority**: Routing through ACP is only acceptable if it preserves the existing runtime
selection behavior that determines how Pi actually runs.

**Independent Test**: Configure a Pi agent with a known model/provider combination, dispatch work,
and confirm the spawned Pi ACP runtime receives and uses that selection without manual operator
intervention.

**Acceptance Scenarios**:

1. **Given** a Pi agent with a configured model and provider, **When** the platform starts that
   agent, **Then** the runtime receives the resolved model/provider settings required for the task.
2. **Given** a Pi agent whose model/provider settings change, **When** a new task is dispatched,
   **Then** the new run reflects the updated settings through the Pi ACP launch path.

---

### User Story 3 - Avoid disruptive registry migration (Priority: P2)

An operator or administrator should not need to bulk-edit existing Pi agent records just to keep Pi
working after the runtime bridge is replaced. Existing Pi registrations continue to resolve to a
working launch path automatically.

**Why this priority**: Reducing migration risk and rollout effort is important, but it depends on
Story 1's execution path working first.

**Independent Test**: Use pre-existing Pi agent records with no manual registry edits, dispatch
work, and confirm the platform selects the new Pi ACP-backed path automatically.

**Acceptance Scenarios**:

1. **Given** a Pi agent record created before this feature, **When** the process manager starts the
   agent, **Then** the agent is routed to the ACP harness path without requiring a database update.
2. **Given** the platform still distinguishes Pi agents from generic ACP agents, **When** operators
   inspect or manage agent records, **Then** Pi remains a recognizable runtime type even though its
   execution path is ACP-based.

---

### User Story 4 - Remove the obsolete Pi-specific runtime bridge safely (Priority: P3)

A maintainer can remove the Pi-specific bridge code after the ACP-backed path is in place, leaving
one less bespoke runtime surface to maintain.

**Why this priority**: Code removal reduces maintenance burden, but only after the replacement path
is proven and existing Pi behavior remains intact.

**Independent Test**: Remove the Pi-specific bridge implementation from the codebase, run the
agreed verification for Pi agent startup/dispatch behavior, and confirm no remaining runtime path
depends on the removed bridge.

**Acceptance Scenarios**:

1. **Given** the ACP-backed Pi path is active, **When** the obsolete Pi-specific bridge file is
   removed, **Then** Pi agents still start and run through the supported path.
2. **Given** the obsolete bridge is removed, **When** maintainers inspect runtime startup code,
   **Then** there is a single supported subprocess protocol path for Pi agent execution.

---

### Edge Cases

- The Pi ACP executable is unavailable at runtime even though a Pi agent is dispatched.
- The Pi executable itself is missing from the runtime environment even though Pi ACP is present.
- A Pi agent record uses legacy runtime metadata that does not explicitly describe ACP-specific
  command settings.
- A Pi agent record contains old per-agent subprocess command overrides that conflict with the
  built-in Pi ACP launch profile.
- Model or provider settings are absent, invalid, or partially configured when a Pi agent starts.
- A Pi task is cancelled while the ACP-backed Pi process is waiting on or streaming a response.
- The ACP subprocess exits before session initialization completes.
- A future Pi ACP release changes packaging or startup expectations in a way that could break the
  platform's launch assumptions.

## Constitution Alignment *(mandatory)*

- **Code Quality Plan**: Replace the Pi-specific bridge with the already-supported ACP harness path
  rather than introducing a second abstraction. Keep the runtime selection logic explicit, remove
  dead code, and verify the Pi startup path, prompt dispatch path, and cancellation path through the
  agreed backend verification for this feature.
- **YAGNI Check**: One new external dependency is required now because the feature's purpose is to
  replace bespoke Pi runtime glue with a maintained ACP adapter. No extra runtime families,
  registry redesign, or speculative adapter abstraction is added beyond what is needed for Pi to
  use the existing ACP harness.
- **Reliability & Operations**: Pi startup failures must produce actionable runtime errors when the
  Pi ACP executable or underlying Pi binary is unavailable. Existing task lifecycle behavior,
  cancellation behavior, and runtime event recording remain intact because Pi now uses the same ACP
  subprocess lifecycle as other ACP-backed agents.
- **UX Consistency**: Operators continue to dispatch Pi agents the same way they do today. The
  migration must not require new operator steps, new runtime terminology in normal flows, or manual
  per-agent repair for existing Pi records.
- **Design Consistency**: No new UI patterns are introduced. Existing agent management and task
  execution surfaces remain the same.
- **Primeloop Architecture Constraints**: Prime routing, delegation records, approvals, and tenant
  assumptions are unchanged. This feature only swaps the subprocess bridge used when a Pi agent is
  launched.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST launch Pi agents through the existing ACP harness path rather than a
  Pi-specific bespoke subprocess bridge.
- **FR-002**: The system MUST use a stable, built-in Pi ACP launch strategy that does not depend on
  a separately managed global installation or per-launch package download.
- **FR-003**: The system MUST continue to pass the resolved model and provider selection for a Pi
  agent into the spawned runtime so the agent runs with the intended configuration.
- **FR-004**: The system MUST preserve the existing Pi agent dispatch lifecycle, including startup,
  prompt delivery, progress streaming, completion, failure handling, and cancellation.
- **FR-005**: The system MUST allow existing Pi agent registry records to continue working without a
  mandatory database migration or manual per-agent config rewrite.
- **FR-006**: The system MUST keep Pi as a distinct runtime family in the registry and runtime
  selection layer, even though the underlying subprocess protocol path is ACP-based.
- **FR-007**: The system MUST route Pi runtime selection through a well-known ACP-backed command
  configuration so Pi startup is deterministic and centrally defined.
- **FR-007a**: Pi agents MUST ignore per-agent subprocess command and argument overrides and always
  launch through the built-in Pi ACP launch profile.
- **FR-008**: The system MUST remove the obsolete Pi-specific harness implementation and any direct
  startup path that depends on it once the ACP-backed Pi path is active.
- **FR-009**: The system MUST fail Pi agent startup with an actionable error when the required Pi
  ACP executable or underlying Pi binary is unavailable.
- **FR-010**: The system MUST preserve environment passthrough required for Pi runtime behavior,
  including the resolved model/provider values and any existing process-level configuration already
  supplied by the platform.
- **FR-011**: The system MUST ensure Pi agents continue to use the same task and delegation
  tracking surfaces as other harness-backed agents so downstream orchestration behavior does not
  change.

### Key Entities *(include if feature involves data)*

- **Pi agent registration**: An existing agent record that identifies the agent as Pi-based for
  operator understanding and runtime selection.
- **Pi runtime launch profile**: The centrally defined command strategy used to start a Pi agent
  through the ACP harness path.
- **Resolved model/provider selection**: The runtime configuration chosen for a Pi task and passed
  into the launched Pi runtime.
- **Pi task session**: A single task run for a Pi agent that uses the platform's normal task,
  delegation, progress, and cancellation lifecycle.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of Pi agent task launches in the agreed verification path use the ACP-backed
  runtime path and zero launches use the retired Pi-specific bridge.
- **SC-002**: Existing Pi agent records used in migration verification require no manual record
  edits to start and complete a task successfully.
- **SC-003**: In migration verification, Pi tasks preserve the expected lifecycle outcomes:
  successful tasks complete, cancelled tasks terminate cleanly, and startup failures produce
  actionable operator-visible errors.
- **SC-004**: Maintainers can identify a single supported subprocess protocol path for Pi runtime
  execution after the feature is delivered.

## Assumptions

- Existing Pi agents already have enough registry information for the process manager to recognize
  them as Pi agents without adding new mandatory data fields.
- Any existing per-agent subprocess command overrides on Pi records are not a supported source of
  truth after this migration.
- The platform prefers a vendored runtime dependency over a global-install or on-demand download
  strategy when that avoids rollout fragility.
- Existing provider/model resolution logic remains the source of truth for Pi runtime selection.
- Pi ACP continues to honor the same environment-based model/provider inputs already used for Pi.
- Generic ACP agent registration behavior remains available separately; this feature only changes
  how Pi-specific registrations are executed.
- No user-facing product workflow changes are required because this is an infrastructure migration
  behind the existing Pi agent experience.
