# Contract: Prime Onboarding API

This contract documents the expected backend/frontend interface for the reworked onboarding flow. Endpoint names may reuse existing `/api/setup`, `/api/providers`, and `/api/prime-agent` routes where practical, but behavior must satisfy this contract.

## Shared Types

### ProviderReadiness

```ts
type ProviderReadiness = 'idle' | 'verifying' | 'verified' | 'failed' | 'skipped' | 'unavailable'
```

### PrimeFunctionKey

```ts
type PrimeFunctionKey =
  | 'orchestration'
  | 'planning'
  | 'coding_execution'
  | 'review_validation'
  | 'platform_maintenance'
```

### FunctionAssignment

```ts
interface FunctionAssignment {
  function_key: string
  display_name: string
  purpose: string
  required: boolean
  provider_id: string | null
  provider_name?: string
  model: string | null
  validation_status: 'missing' | 'valid' | 'warning' | 'blocked'
  warnings: string[]
  is_default_choice: boolean
  fallbacks?: Array<{ provider_id: string; model: string }>
}
```

### PluginChoice

```ts
interface PluginChoice {
  plugin_id: string
  name: string
  description: string
  availability: 'available' | 'unavailable' | 'unknown'
  selected: boolean
  configuration_state: 'not_required' | 'deferred_post_launch' | 'configured' | 'unavailable'
  post_launch_configuration_required: boolean
}
```

### TeamPlan

```ts
interface TeamPlan {
  id: string
  purpose: string
  confirmation_status: 'proposed' | 'confirmed' | 'rejected' | 'partially_confirmed'
  agents: Array<{
    role: string
    name: string
    rationale: string
    recommendation_strength: 'strongly_recommended' | 'optional'
    category: 'platform_maintenance' | 'goal_specific'
    capabilities: string[]
  }>
  created_agent_ids: string[]
}
```

## GET `/api/setup/status`

Returns current onboarding completion and resume state.

### Response 200

```json
{
  "complete": false,
  "current_step": "providers",
  "status": "in_progress",
  "can_resume": true,
  "last_error": null
}
```

### Requirements

- Must not include raw provider credentials.
- Must treat existing completed setup as complete.
- Must expose enough state for the UI to resume the correct step.

## GET `/api/setup/draft`

Returns the current onboarding draft.

### Response 200

```json
{
  "current_step": "function_assignment",
  "providers": [
    {
      "id": "provider-id",
      "name": "local-main",
      "type": "ollama",
      "base_url": "http://localhost:11434",
      "masked_credential_state": "not_required",
      "connection_status": "verified",
      "available_models": ["qwen3-coder-next"],
      "verification_error": null
    }
  ],
  "function_assignments": [],
  "prime_config_draft": {},
  "plugin_choices": [],
  "launch_readiness": {
    "ready": false,
    "blocking_reasons": ["Missing planning assignment"]
  }
}
```

### Requirements

- Must return masked credential state only.
- Must include default Prime function assignments when no assignments exist yet.

## PUT `/api/setup/draft`

Persists onboarding progress without launching Prime.

### Request

```json
{
  "current_step": "plugins",
  "function_assignments": [
    {
      "function_key": "planning",
      "provider_id": "provider-id",
      "model": "claude-sonnet-4-6",
      "fallbacks": []
    }
  ],
  "prime_config_draft": {
    "cron_fast_interval_seconds": 300,
    "debounce_window_ms": 10000
  },
  "plugin_choices": [
    {
      "plugin_id": "context-mode",
      "selected": true
    }
  ]
}
```

### Response 200

```json
{
  "ok": true,
  "launch_readiness": {
    "ready": false,
    "blocking_reasons": ["Missing review/validation assignment"]
  }
}
```

### Requirements

- Must validate known assignment shape and plugin choice shape.
- Must preserve progress for resume.
- Must not persist raw provider secrets in draft state.

## POST `/api/setup/provider-models`

Existing endpoint for model discovery. It should continue to support cloud and local providers.

### Request

```json
{
  "type": "ollama",
  "base_url": "http://localhost:11434",
  "api_key": "optional transient secret"
}
```

### Response 200

```json
{
  "models": ["llama3.1", "qwen3-coder-next"],
  "error": null
}
```

### Requirements

- API key in request is transient for discovery and must not be returned.
- Failure should return a recoverable error shape where possible.

## POST `/api/setup/validate-launch`

Validates the current draft for Prime launch.

### Response 200

```json
{
  "ready": true,
  "blocking_reasons": [],
  "warnings": [
    "coding/execution and review/validation reuse the same provider/model"
  ],
  "summary": {
    "providers": 2,
    "required_functions": 5,
    "selected_plugins": 1
  }
}
```

### Requirements

- Must block if any required Prime function lacks a valid assignment.
- Must allow assignment reuse across multiple functions.
- Must include model capability warnings from existing model assessment rules.

## POST `/api/setup/complete`

Extends the existing completion endpoint to finalize provider/model assignments, plugin choices, Prime configuration review, and optional launch.

### Request

```json
{
  "providers": [],
  "function_assignments": [
    {
      "function_key": "orchestration",
      "provider_id": "provider-id",
      "model": "claude-sonnet-4-6"
    }
  ],
  "prime_config": {
    "cron_fast_interval_seconds": 300,
    "cron_slow_interval_seconds": 3600,
    "debounce_window_ms": 10000,
    "cost_controls": { "monthly_token_budget": 0 }
  },
  "plugin_choices": [
    { "plugin_id": "context-mode", "selected": true }
  ],
  "workspace": {
    "mode": "local",
    "root_path": "../.agent-workspace",
    "branch": "main"
  },
  "launch": true
}
```

### Response 200

```json
{
  "ok": true,
  "prime_launch": {
    "status": "launched",
    "thread_id": "thread-id"
  }
}
```

### Requirements

- Must write finalized assignments to Prime model preferences.
- Must mark `setup_complete=true` only after required validation passes.
- Must create or reuse the onboarding Prime conversation thread when `launch=true`.
- Must preserve recoverable error details on launch failure.

## GET `/api/setup/plugins`

Returns optional pi plugins known to onboarding.

### Response 200

```json
{
  "plugins": [
    {
      "plugin_id": "context-mode",
      "name": "context-mode",
      "description": "Large-output processing and searchable context support",
      "availability": "available",
      "selected": false,
      "configuration_state": "deferred_post_launch",
      "post_launch_configuration_required": true
    }
  ]
}
```

### Requirements

- Empty list is valid and must not block onboarding.
- Unavailable plugin inventory must return a placeholder state rather than a broken response.

## POST `/api/setup/team-plan/:id/confirm`

Confirms Prime's proposed team plan and creates selected agents.

### Request

```json
{
  "selected_roles": ["sre", "devops", "frontend-specialist"],
  "confirm": true
}
```

### Response 200

```json
{
  "team_plan": {
    "id": "team-plan-id",
    "confirmation_status": "confirmed",
    "created_agent_ids": ["agent-id-1", "agent-id-2"]
  }
}
```

### Requirements

- Must require explicit confirmation.
- SRE and DevOps platform maintenance agents must be strongly recommended in the plan.
- Optional goal-specific agents may be omitted by the user.
- Failures must preserve the team plan for retry or manual follow-up.
