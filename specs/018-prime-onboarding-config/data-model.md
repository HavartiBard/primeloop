# Data Model: Prime Onboarding Configuration

## Onboarding Session

Represents the single operator's in-progress setup flow.

**Fields**:

- `id`: stable singleton identifier, default `default`
- `current_step`: intro, providers, function_assignment, prime_config, plugins, workspace, launch, prime_conversation, complete
- `status`: not_started, in_progress, blocked, ready_to_launch, launching, launched, complete
- `provider_choices`: references to selected provider records and readiness summaries
- `function_assignments`: map of Prime function key to assignment
- `prime_config_draft`: editable Prime configuration values before launch
- `plugin_choices`: selected optional pi plugins and post-launch configuration state
- `team_plan`: latest proposed/confirmed team plan, if any
- `last_error`: user-facing recoverable error summary, if any
- `created_at`, `updated_at`

**Relationships**:

- References many Model Providers by id.
- Owns many Prime Function Assignments for the active setup draft.
- Owns many Plugin Choices for the active setup draft.
- References one Prime Launch after launch starts.
- References one Setup Conversation after Prime starts.

**Validation rules**:

- Only one active onboarding session is needed for single-tenant ACP.
- Cannot enter `ready_to_launch` until all required Prime functions have valid provider/model assignments.
- Must not contain raw provider secrets; secret values live only through existing provider secret handling.

## Model Provider

A cloud or local source of models available to onboarding.

**Fields**:

- `id`
- `name`
- `type`: anthropic, openai, ollama, litellm, llm, codex, or configured provider type
- `base_url`
- `masked_credential_state`: absent, present, needs_replacement, not_required
- `connection_status`: idle, verifying, verified, failed, skipped, unavailable
- `available_models`: discovered or manually entered model names
- `verification_error`: user-facing error summary
- `timeout_ms`
- `created_at`, `updated_at`

**Relationships**:

- May be referenced by many Prime Function Assignments.
- Stores credentials only through existing encrypted provider storage.

**Validation rules**:

- `name`, `type`, and `base_url` are required.
- Stored API keys are never returned in raw form.
- Local providers may be valid without API keys.

## Model Choice

A selectable model from a provider.

**Fields**:

- `provider_id`
- `model`
- `source`: discovered, default, manual
- `availability`: available, unknown, unavailable
- `capability_tier`: blocked, warning, acceptable, preferred, unknown
- `warnings`: user-facing warning strings

**Relationships**:

- Belongs to one Model Provider.
- May be used by many Prime Function Assignments.

**Validation rules**:

- Blocked model choices cannot satisfy required Prime function assignments.
- Unknown availability can be used only when the user explicitly confirms the fallback/manual path.

## Prime Function Assignment

Maps one Prime function/base module to the provider/model used for that function.

**Default onboarding functions**:

- `orchestration`
- `planning`
- `coding_execution`
- `review_validation`
- `platform_maintenance`

**Fields**:

- `function_key`
- `display_name`
- `purpose`
- `required`: boolean
- `provider_id`
- `model`
- `is_default_choice`: boolean
- `validation_status`: missing, valid, warning, blocked
- `warnings`
- `fallbacks`: optional ordered provider/model entries

**Relationships**:

- Belongs to the Onboarding Session or finalized Prime Agent Configuration.
- References one primary Model Provider and Model Choice.

**Validation rules**:

- Every required function must have a valid assignment before Prime launch.
- Multiple required functions may reuse the same provider/model.
- The rendered function list may include product-configured functions beyond the default set, but default coverage must remain present.

## Prime Agent Configuration

The launch-ready configuration for the native Prime service.

**Fields**:

- `id`: default
- `enabled`
- `setup_complete`
- `model_preferences`: per-function primary/fallback routes
- `provider_routing`: legacy compatibility routing
- `cost_controls`
- `git_store`
- `cron_fast_interval_seconds`
- `cron_slow_interval_seconds`
- `debounce_window_ms`
- `status`
- `last_started_at`
- `last_error`
- `created_at`, `updated_at`

**Relationships**:

- Receives finalized Prime Function Assignments.
- Drives Prime Launch.
- May refer to Plugin Choices through setup/onboarding metadata if plugin persistence is added.

**Validation rules**:

- Prime cannot be enabled/launched from onboarding unless required function assignments are valid.
- User-adjustable fields must be validated before launch summary is accepted.

## Plugin Choice

An optional pi plugin selected during onboarding.

**Fields**:

- `plugin_id`
- `name`
- `description`
- `availability`: available, unavailable, unknown
- `selected`: boolean
- `configuration_state`: not_required, deferred_post_launch, configured, unavailable
- `post_launch_configuration_required`: boolean

**Relationships**:

- Belongs to one Onboarding Session.
- May later influence Prime capabilities or setup conversation prompts.

**Validation rules**:

- Plugin selection is optional and cannot block Prime launch.
- Detailed plugin-specific configuration is deferred until after Prime is running.

## Prime Launch

The transition from validated onboarding configuration to running Prime.

**Fields**:

- `id`
- `status`: pending, launching, launched, failed
- `configuration_snapshot`
- `failure_reason`
- `recovery_action`: edit_config, retry, return_to_onboarding
- `started_at`, `completed_at`

**Relationships**:

- Uses one Prime Agent Configuration snapshot.
- Creates or references one Setup Conversation thread.

**Validation rules**:

- Failure must preserve the configuration snapshot and allow retry/edit.
- Launch must not create team agents automatically.

## Setup Conversation

The post-launch Prime conversation that completes setup intent gathering.

**Fields**:

- `thread_id`
- `status`: active, awaiting_user, proposing_team, complete, failed
- `user_goals`
- `prime_questions`
- `setup_decisions`
- `team_plan_id`
- `failure_reason`

**Relationships**:

- Belongs to one Prime Launch.
- Produces one Agent Team Plan.

**Validation rules**:

- Must preserve conversation context when team creation fails.
- Must ask focused setup questions before proposing optional goal-specific agents.

## Agent Team Plan

The recommended set of agents derived from the setup conversation.

**Fields**:

- `id`
- `purpose`
- `agents`: array of proposed agent entries
- `confirmation_status`: proposed, confirmed, rejected, partially_confirmed
- `created_agent_ids`: created durable/ephemeral agents after confirmation
- `created_at`, `confirmed_at`

**Proposed agent entry fields**:

- `role`
- `name`
- `rationale`
- `recommendation_strength`: strongly_recommended, optional
- `category`: platform_maintenance, goal_specific
- `capabilities`
- `provider_model_preference`: optional inherited preference

**Validation rules**:

- SRE and DevOps agents for ACP platform maintenance must be strongly recommended by default.
- Goal-specific agents may be optional.
- No agents are created until the user confirms the proposed plan.

## State Transitions

```text
Onboarding Session:
not_started → in_progress → blocked
                         ↘ ready_to_launch → launching → launched → complete
                                      ↘ blocked/failed → in_progress

Provider readiness:
idle → verifying → verified
              ↘ failed → verifying
              ↘ skipped

Prime launch:
pending → launching → launched
                  ↘ failed → pending

Team plan:
proposed → confirmed → created
        ↘ rejected
        ↘ partially_confirmed → created
```
