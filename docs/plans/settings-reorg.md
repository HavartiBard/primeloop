# Settings Reorganization + Model Preferences Module

## Problem Statement

1. **Chaotic settings organization**: 10 tabs in the Governance page with no clear hierarchy (Modules, Workspace, Governance, Approvals, Patterns, Memory, Audits, Loop Monitor, Learnings, Snapshots)
2. **Runtime state mixed with config**: `status`, `last_started_at`, `last_error` live in `prime_agent_config` alongside actual settings
3. **No Model Preferences UI**: `provider_routing` is a raw JSON blob — no per-function primary/fallback model selection
4. **Settings scattered across 4 locations**: `prime_agent_config` table, `prime_agent_modules` table, workspace files, `chief_profiles` table
5. **Profile settings orphaned**: Prime personality/behavior settings exist in `/api/prime-agent/profile` but have no dedicated settings tab

## Solution Overview

### New Tab Structure (5 tabs)

| Tab | Content | Source |
|-----|---------|--------|
| **System** | Enabled toggle, cron intervals, debounce window, status display | `prime_agent_config` |
| **Models** | Per-function model preferences with primary + fallback chains | NEW `model_preferences` field |
| **Modules** | Module registry (unchanged) | `prime_agent_modules` |
| **Profile** | Personality, voice, decision style, behaviors, approval thresholds | `chief_profiles` + workspace files via `/api/prime-agent/profile` |
| **Workspace** | File browser/editor (unchanged) | `agent_workspace_config` |

The fleet monitoring tabs (Approvals, Patterns, Memory, Audits, Loop Monitor, Learnings, Snapshots) are observational/monitoring data — they belong on a separate "Fleet" page, not in Settings. For now, keep them accessible but visually separated or collapsed.

### Model Preferences Schema

```typescript
interface ModelRouteEntry {
  provider_id: string   // UUID from providers table
  model: string         // model name, e.g. "claude-sonnet-4-20250514"
}

interface FunctionModelPreference {
  primary: ModelRouteEntry       // first-choice model
  fallbacks: ModelRouteEntry[]   // ordered fallback chain (tried on failure)
}

// Stored in prime_agent_config.model_preferences (JSONB)
type ModelPreferences = Record<string, FunctionModelPreference>

// Example:
{
  "planning": {
    "primary": { "provider_id": "anthropic-main", "model": "claude-sonnet-4-20250514" },
    "fallbacks": [
      { "provider_id": "openai-main", "model": "gpt-4o" },
      { "provider_id": "ollama-local", "model": "qwen3-32b" }
    ]
  },
  "routing": {
    "primary": { "provider_id": "openai-main", "model": "gpt-4o-mini" },
    "fallbacks": []
  }
}
```

**Function types** (registered in the `model_preferences` keys):
- `planning` — Primary decision-making (goal analysis, action planning)
- `routing` — Domain classification and task routing
- `context` — Context assembly and summarization (future use)
- `policy` — Policy evaluation and compliance checks (future use)

The LLM router currently uses `provider_routing.planning` or `provider_routing.routing`. With model_preferences, it converts the preference chain into an ordered route array for fallback iteration.

## Implementation Plan

### Phase 1: Backend — Database + Types

#### 1.1. Migration (`db.ts`)
- Add `model_preferences JSONB NOT NULL DEFAULT '{}'` column to `prime_agent_config`
- Migrate existing `provider_routing` data to `model_preferences` format on first read

#### 1.2. Types (`prime-agent/config.ts`)
- Add `ModelRouteEntry`, `FunctionModelPreference`, `ModelPreferences` interfaces
- Add `model_preferences` to `PrimeConfig` and `PrimeConfigPatch`
- Keep `provider_routing` for backward compatibility (deprecated)

#### 1.3. Config Service (`prime-agent/config.ts`)
- Add `migrateProviderRoutingToModelPreferences()` helper
- Call migration in `getPrimeConfig()` if `model_preferences` is empty but `provider_routing` has data
- Handle `model_preferences` in `updatePrimeConfig()`

### Phase 2: Backend — API + Router Integration

#### 2.1. Route Validation (`routes/prime-agent.ts`)
- Add `model_preferences` validation in `validatePrimeConfigPatch()`
- Validate: each function key has a valid primary (non-empty provider_id, model), fallbacks are arrays of valid entries

#### 2.2. LLM Router (`prime-agent/llm-router.ts`)
- Update `createConfiguredLlmRouter()` to read from `model_preferences` first
- Convert preference chain to ordered route array: `[primary, ...fallbacks]`
- Fall back to legacy `provider_routing` if `model_preferences` is empty for the function type

### Phase 3: Backend — Tests

#### 3.1. Config Tests (`tests/prime-agent/config.test.ts`)
- Test default `model_preferences` is `{}`
- Test migration from `provider_routing` to `model_preferences`
- Test updating `model_preferences` via patch

#### 3.2. Route Tests (`tests/prime-agent/route.test.ts`)
- Test PATCH /config with valid `model_preferences`
- Test PATCH /config rejects invalid model preferences (missing provider_id, empty model)

### Phase 4: Frontend — Settings Reorganization

#### 4.1. Tab Reorganization (`web/src/pages/Governance.tsx`)
- Replace 10 tabs with 5 primary tabs: System, Models, Modules, Profile, Workspace
- Keep fleet monitoring tabs accessible via a secondary "Fleet" section or sub-tabs

#### 4.2. System Tab (NEW)
- Enabled toggle switch
- Fast cron interval input (seconds)
- Slow cron interval input (seconds)
- Debounce window input (ms)
- Status display (read-only, from runtime)
- Last error display (read-only)

#### 4.3. Models Tab (NEW — Model Preferences UI)
- Function type selector (planning, routing, etc.)
- For each function:
  - Primary model selector (dropdown of providers × models)
  - Fallback chain (ordered list with add/remove/reorder)
  - Model capability assessment badge per model
- "Save Model Preferences" button
- Empty state: "No model preferences configured. Prime will use the default provider."

#### 4.4. Profile Tab (NEW — integrate existing prime-profile route)
- Read from `/api/prime-agent/profile`
- Edit sections: identity, voice_tone, decision_style, default_behaviors, approval_thresholds
- Save via PUT /api/prime-agent/profile or PATCH /sections/:key

#### 4.5. Web API Functions (`web/src/api.ts`)
- Add `fetchPrimeConfig()` → GET /api/prime-agent/config
- Add `updatePrimeConfig(patch)` → PATCH /api/prime-agent/config
- Already have: `fetchPrimeProfile()`, `updatePrimeProfile()`, `patchPrimeProfileSection()`

#### 4.6. Web Types (`web/src/types.ts`)
- Add `PrimeConfig`, `ModelRouteEntry`, `FunctionModelPreference`, `ModelPreferences` types

### Phase 5: Verification

- Run `cd backend && npm test` to verify all tests pass
- Manual verification: Settings page loads with new tabs, model preferences can be configured

## Files Changed

### Backend
- `backend/src/db.ts` — Add migration for `model_preferences` column
- `backend/src/prime-agent/config.ts` — New types, migration logic, update support
- `backend/src/routes/prime-agent.ts` — Validation for `model_preferences` in patch
- `backend/src/prime-agent/llm-router.ts` — Read from `model_preferences` with fallback to `provider_routing`
- `backend/tests/prime-agent/config.test.ts` — Tests for model preferences
- `backend/tests/prime-agent/route.test.ts` — Tests for model preferences validation

### Frontend
- `web/src/pages/Governance.tsx` — Complete reorganization of settings tabs
- `web/src/api.ts` — Add `fetchPrimeConfig`, `updatePrimeConfig` functions
- `web/src/types.ts` — Add PrimeConfig-related types

## Backward Compatibility

- `provider_routing` field is preserved in the DB and API
- LLM router falls back to `provider_routing` if `model_preferences` is empty
- Migration from `provider_routing` → `model_preferences` is automatic on first read
