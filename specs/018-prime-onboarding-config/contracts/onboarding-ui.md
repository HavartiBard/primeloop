# Contract: Prime Onboarding UI

## Primary Flow

The setup wizard keeps the current onboarding direction while adding explicit Prime configuration steps.

```text
Intro
→ Providers
→ Prime Function Assignments
→ Prime Configuration Review
→ Optional Plugins
→ Rules / Workspace
→ Launch
→ Prime Setup Conversation
→ Team Plan Confirmation
```

Rules/workspace may remain in their current order if implementation keeps the existing wizard structure, but launch must occur only after providers, required function assignments, Prime config review, and plugin selection/skip are resolved.

## Step Contract

### Intro

**Must show**:

- What Prime will configure during onboarding.
- That cloud and local providers are supported.
- That optional plugins can be selected but configured later.
- That Prime will propose a team and require confirmation before creating agents.

### Providers

**Must show**:

- Cloud provider setup options.
- Local LLM provider setup options.
- Connection/readiness state: idle, verifying, verified, failed, skipped, unavailable.
- Model discovery results or manual fallback.
- Masked credential state for existing provider secrets.

**Must allow**:

- Adding/editing providers.
- Retrying model discovery.
- Continuing with cloud-only, local-only, or mixed providers when launch readiness can still be satisfied.

**Must not show**:

- Raw stored provider credentials.

### Prime Function Assignments

**Must show default required functions**:

- Orchestration
- Planning
- Coding/execution
- Review/validation
- Platform maintenance

**Must show per function**:

- Purpose/explanation.
- Required/optional status.
- Provider selector.
- Model selector or manual model entry fallback.
- Capability warning/blocking state.
- Whether the choice is a recommended default.

**Must allow**:

- Reusing the same provider/model across multiple required functions.
- Editing assignments before launch.

**Must block**:

- Launch when any required function is missing or blocked.

### Prime Configuration Review

**Must show**:

- Default Prime configuration values in understandable sections.
- Function assignment summary.
- Provider readiness summary.
- Cost/rules/workspace values that affect launch.
- Validation warnings and blocking errors.

**Must allow**:

- Accepting defaults without extra decisions.
- Editing supported configuration values.
- Returning to provider/function steps to fix blocking issues.

### Optional Plugins

**Must show**:

- Available pi plugins when inventory is available.
- Placeholder/empty state when inventory is unavailable or empty.
- Selected plugin summary.
- Post-launch configuration indicator for plugins that require deeper setup.

**Must allow**:

- Selecting plugins.
- Skipping all plugins.
- Continuing when plugin inventory is unavailable.

**Must not block**:

- Prime launch solely because plugin-specific configuration is incomplete.

### Launch

**Must show**:

- Final launch readiness.
- Provider/model assignments for every required Prime function.
- Masked provider credential status.
- Optional plugin selections.
- Prime configuration adjustments.
- Clear action to launch Prime.

**Must handle**:

- Launching state.
- Success state with transition to Prime conversation.
- Recoverable failure state with edit/retry/return options.

### Prime Setup Conversation

**Must show**:

- Prime greeting and focused setup questions.
- Conversation context preserved from onboarding.
- Clear indication that Prime is preparing a team plan, not creating agents automatically.

### Team Plan Confirmation

**Must show**:

- Proposed team purpose.
- Strongly recommended SRE agent for ACP platform maintenance.
- Strongly recommended DevOps agent for ACP platform maintenance.
- Optional goal-specific agents separately marked.
- Rationale for each proposed agent.
- Confirm/reject/select controls.

**Must require**:

- Explicit user confirmation before creating agents.

**Must handle**:

- Partial confirmation where optional agents are omitted.
- Creation success with links/visibility to created agents.
- Creation failure with preserved plan and retry/manual follow-up.

## Empty, Loading, Error, and Resume States

- Provider discovery loading states must keep current draft visible.
- Plugin inventory failure must show a non-blocking placeholder.
- Missing providers must guide users toward cloud or local setup.
- Missing assignments must identify exact required functions.
- Returning to onboarding must restore completed provider, assignment, configuration, plugin, and workspace choices.
- Launch/team failures must not discard completed configuration.

## Accessibility and Visual Consistency

- All wizard navigation, provider selectors, model selectors, plugin checkboxes, launch controls, and team confirmation controls must be keyboard-operable.
- Status messages must be text-visible, not color-only.
- Reuse existing setup card styling, progress indicators, warning banners, buttons, and summary sections where practical.
- New assignment matrix and team plan confirmation patterns must match existing ACP spacing, typography, hierarchy, and calm operator-control tone.

## Acceptance Checklist

- User can complete onboarding with cloud-only provider if all required functions are valid.
- User can complete onboarding with local-only provider if all required functions are valid.
- User can reuse one provider/model across all required Prime functions.
- User can see model capability warnings before launch.
- User can select or skip plugins without blocking launch.
- User can launch Prime and enter setup conversation.
- User must confirm team plan before agents are created.
- SRE and DevOps agents are strongly recommended by default for ACP platform maintenance.
