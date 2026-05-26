# Research: Prime Onboarding Configuration

## Decision: Reuse the current setup wizard and extend it rather than replacing it

**Rationale**: The existing `web/src/pages/Setup.tsx` already models the main onboarding progression: intro, providers, routing, personality/profile, rules, workspace, and launch. The feature explicitly asks to keep the general idea of the current workflow while reworking provider/model and Prime setup. Extending this path reduces migration risk and keeps user-facing continuity.

**Alternatives considered**:

- Build a separate onboarding app: rejected because it duplicates setup state and creates a competing flow.
- Skip wizard structure and launch directly into Prime chat: rejected because provider credentials, model assignment, and launch readiness need explicit validation before Prime starts.

## Decision: Model Prime provider/model selection as required function assignments

**Rationale**: The clarified default function set is orchestration, planning, coding/execution, review/validation, and platform maintenance. Existing Prime config already supports `model_preferences` with per-function primary/fallback route entries, while legacy `provider_routing` remains present for compatibility. The onboarding design should validate every required function before launch and allow one provider/model to serve multiple functions.

**Alternatives considered**:

- One global Prime model: rejected because the feature requires per-function/base-module model choices.
- Require distinct models per function: rejected because it makes local-only and low-cost setups unnecessarily hard.
- Completely dynamic functions only: rejected because tasks and tests need a default onboarding target.

## Decision: Preserve encrypted provider secret handling and show masked readiness state

**Rationale**: Existing setup and provider routes encrypt API keys before persistence. The clarified requirement says credentials should be collected during onboarding but stored only through existing secret handling, and later screens should show masked values and readiness status. This reduces security risk and avoids normalizing raw secret exposure in review screens.

**Alternatives considered**:

- Store credentials directly in onboarding draft JSON: rejected because it risks exposing secrets and bypassing existing protection.
- Never store credentials during onboarding: rejected because it prevents resume/retry behavior and makes verification flows frustrating.

## Decision: Treat plugin onboarding as optional selection with post-launch configuration

**Rationale**: The user wants a placeholder for choosing pi plugins, but detailed plugin configuration is not required before Prime can launch. OpenSwarm-inspired tool/library patterns support showing available capabilities and permission/configuration status without forcing every integration to be complete up front. Onboarding should save selected plugins and mark detailed configuration as post-launch work.

**Alternatives considered**:

- Placeholder only with no saved selection: rejected because the feature asks users to choose plugins optionally.
- Full plugin configuration before launch: rejected because it blocks the core onboarding path and expands scope into plugin-specific setup.

## Decision: Use OpenSwarm as UX inspiration for capability selection, not as implementation source

**Rationale**: OpenSwarm presents agents, modes, skills/tools, model choices, approvals, and local-first oversight as visible product concepts. Useful patterns for ACP onboarding are: capability libraries, clear permission/configuration states, explicit model/mode selection, human approval before agent actions, and persistent local control. ACP should adapt these ideas to existing Prime, provider, pi plugin, and durable record concepts without copying branding or implementation details.

**Alternatives considered**:

- Copy OpenSwarm screens and terminology: rejected because ACP has its own Prime-centered model and existing setup vocabulary.
- Ignore OpenSwarm after initial inspiration: rejected because the spec explicitly requires reviewing OpenSwarm-inspired onboarding and agent setup patterns.

## Decision: Launch Prime into an onboarding thread and require confirmation before agent creation

**Rationale**: Existing setup launch already creates an onboarding thread when Prime is launched. The clarified behavior requires Prime to propose a team plan and create agents only after confirmation, while strongly recommending SRE and DevOps agents for ACP platform maintenance. This keeps Prime conversational and action-oriented while preserving user control over new agents and cost/operational footprint.

**Alternatives considered**:

- Automatically create all recommended agents: rejected because it creates surprise changes and cost risk.
- Only recommend agents with no creation path: rejected because the feature expects onboarding to build a team after the user confirms.

## Decision: Persist onboarding progress as durable setup state

**Rationale**: The spec requires users to resume incomplete onboarding with completed choices restored. Provider records and Prime config already persist parts of the setup, but the expanded flow includes draft function assignments, plugin choices, launch readiness, and team confirmation state. Planning should add the smallest durable state needed to resume these choices without introducing multi-user/session complexity.

**Alternatives considered**:

- Browser-only local state: rejected because it fails resume across browsers/devices and is not authoritative.
- Full multi-user onboarding sessions: rejected as out of scope for single-tenant ACP.

## Decision: Keep verification focused on route behavior, validation, and wizard acceptance flows

**Rationale**: Backend route tests already cover setup/providers, and frontend tests cover React components/hooks. This feature changes user flow and validation more than low-level algorithms, so tests should cover provider readiness, masked credentials, function assignment validation, plugin skip/select behavior, launch failure recovery, and team confirmation.

**Alternatives considered**:

- End-to-end browser-only testing: rejected as insufficient for secret handling and backend validation.
- Backend-only testing: rejected because wizard state and UX validation are central to the feature.
