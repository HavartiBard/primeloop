# Quickstart: Prime Onboarding Configuration

This quickstart describes acceptance-level verification for the reworked onboarding flow. It is not an implementation script.

## Preconditions

- ACP backend and web UI can run in the normal development environment.
- At least one provider path is available for testing:
  - cloud provider with test credentials, or
  - local provider such as Ollama-compatible endpoint, or
  - mocked provider/model discovery in tests.
- Existing setup can start from an incomplete state.

## Scenario 1: Local-only onboarding reaches Prime configuration review

1. Start from an incomplete setup state.
2. Open onboarding.
3. Skip cloud credentials or leave cloud providers inactive.
4. Add a local LLM provider.
5. Discover or manually enter a usable model.
6. Assign that provider/model to all required Prime functions:
   - orchestration
   - planning
   - coding/execution
   - review/validation
   - platform maintenance
7. Continue to Prime configuration review.

**Expected result**: The review shows all required functions assigned, no raw credential values, and launch readiness unless another required setup field is missing.

## Scenario 2: Cloud + local mixed routing

1. Add a cloud provider and a local provider.
2. Assign a stronger cloud model to orchestration and planning.
3. Assign a local model to coding/execution or platform maintenance.
4. Review the summary.

**Expected result**: The summary clearly identifies each function's provider/model and shows warnings for any unsuitable model.

## Scenario 3: Required assignment validation blocks launch

1. Complete provider setup with at least one usable provider.
2. Leave review/validation unassigned.
3. Attempt to launch Prime.

**Expected result**: Launch is blocked, the missing required function is identified, and the user can return to fix it.

## Scenario 4: Provider secret masking and retry

1. Add a provider with credentials.
2. Save or proceed to a later step.
3. Return to provider editing.

**Expected result**: The UI shows masked credential state and readiness status, not the raw secret. The user can replace the credential and retry verification.

## Scenario 5: Optional plugin selection is non-blocking

1. Reach the plugin step.
2. Select one available pi plugin, if available.
3. Confirm it is marked for post-launch configuration when needed.
4. Return and skip all plugins.

**Expected result**: Both select and skip paths allow onboarding to continue. Plugin-specific configuration is not required before Prime launch.

## Scenario 6: Prime launches into setup conversation

1. Complete providers, function assignments, Prime config review, optional plugins, rules, and workspace.
2. Launch Prime.
3. Open the created onboarding conversation.

**Expected result**: Prime starts with the finalized configuration and asks focused setup questions about what the user wants to accomplish.

## Scenario 7: Team plan requires confirmation

1. Complete the Prime setup conversation with a user goal.
2. Review Prime's proposed team plan.
3. Confirm only the strongly recommended platform maintenance agents.
4. Optionally omit goal-specific agents.

**Expected result**: SRE and DevOps agents are strongly recommended for ACP platform maintenance. No agents are created until confirmation. Optional agents can be omitted.

## Scenario 8: Resume incomplete onboarding

1. Complete provider setup and at least one function assignment.
2. Leave onboarding before launch.
3. Reopen onboarding.

**Expected result**: The previous provider choices, readiness states, assignments, configuration edits, and plugin choices are restored.

## Verification Focus

- Backend route tests for provider/model discovery, secret masking, draft persistence, launch validation, and completion.
- Backend tests for Prime model preference translation from function assignments.
- Frontend tests for wizard step validation, assignment reuse, plugin skip/select, and launch/team confirmation states.
- Manual or automated acceptance walkthrough for local-only and mixed-provider flows.

## Out of Scope for Quickstart

- Plugin marketplace installation.
- Organization/multi-user policy setup.
- Billing setup.
- Fully autonomous team creation without confirmation.

## Execution Results (Spec Closure)

- All implementation tasks in `specs/018-prime-onboarding-config/tasks.md` are marked complete through T065.
- Quickstart scenarios remain the acceptance checklist used for walkthrough validation of provider setup, assignment validation, plugin optionality, Prime launch, and team confirmation.
- No additional repository-level verification command is explicitly defined in this spec package; therefore no extra command was run for closure.
