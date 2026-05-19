# Issue #26: Add model size warnings in provider/agent configuration UI

## Summary

Implemented model capability assessment with warnings and blocking for small models used in Prime Agent routing.

## Changes Made

### Backend

1. **`backend/src/prime-agent/model-capability.ts`** (new file)
   - Model metadata lookup mapping known model names to estimated parameter counts
   - Pattern-based matching for 50+ known models across Anthropic, OpenAI, Llama, Qwen, Mistral, Gemma, DeepSeek, Cohere, Microsoft Phi families
   - Dynamic size extraction fallback (e.g., `my-model-13b`)
   - `assessModelCapability(modelName)` function returning tier classification:
     - **`recommended`** (≥ 7B params): no warning
     - **`warned`** (3B–7B params): warning about reliability
     - **`blocked`** (< 3B params): blocked from Prime routing
   - Warning messages explain *why* (JSON reliability, response quality)

2. **`backend/src/prime-agent/llm-router.ts`**
   - Imported `assessModelCapability` from new module
   - Added capability validation in `createConfiguredLlmRouter()`:
     - Throws error for blocked models (< 3B): `"model 'X' is blocked from Prime routing"`
     - Logs warning for sub-7B models via `console.warn()`

3. **`backend/src/routes/providers.ts`**
   - Added `POST /api/providers/model-capability` endpoint
   - Accepts `{ model: string }` in request body
   - Returns full `ModelCapabilityAssessment` object

### Frontend

4. **`web/src/types.ts`**
   - Added `ModelTier` type (`'recommended' | 'warned' | 'blocked'`)
   - Added `ModelCapabilityAssessment` interface

5. **`web/src/api.ts`**
   - Added `fetchModelCapability(model: string)` function calling the new endpoint

6. **`web/src/pages/Providers.tsx`**
   - Provider modal: real-time model capability assessment when user types a model name
     - Red blocked banner for < 3B models
     - Amber warning banner for 3B–7B models
   - Providers table: inline `ModelCapabilityBadge` component showing capability status per row
     - `⛔ blocked` for sub-3B models
     - `⚠ N B` for sub-7B models with tooltip showing full warning

7. **`web/src/pages/Setup.tsx`**
   - RoutingRow component: real-time model capability assessment for each routing entry
     - Red blocked banner below model selector for < 3B models
     - Amber warning banner for 3B–7B models
   - Assesses all configured Prime routes (planning, dispatching, discussion)

## Acceptance Criteria Status

- ✅ User sees a visible warning when configuring a sub-7B model for Prime routing
- ✅ Models under 3B are blocked from Prime decision-making with a clear error message
- ✅ Warning text explains *why* (JSON reliability, response quality) not just *what*
- ✅ The check doesn't block legitimate use of small models for non-Prime tasks

## Verification

```
cd web && npm run build  → ✓ built in 16.55s (all type checks pass)
cd backend && npx vitest run tests/prime-agent/llm-router.test.ts  → ✓ 15 passed
```

Pre-existing test failures (service.test.ts mock issues, providers.route.test.ts DB connection) are unrelated to these changes.
