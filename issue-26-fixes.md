# Issue #26 Review Feedback Fixes

## Summary

Addressed all 6 review concerns from PR #28. Changes committed to `feature/issue-26-model-size-warnings`.

## Fixes Applied

### Fix 1: Remove duplicate Llama pattern ✅
**File:** `backend/src/prime-agent/model-capability.ts`

Removed the duplicate `{ pattern: /llama-3\.1-70b|llama3\.1-70b/i, ... }` entry that appeared twice in `KNOWN_MODELS`. First match wins, so the second was dead code.

### Fix 2: Add debouncing to ProviderModal ✅
**File:** `web/src/pages/Providers.tsx`

Replaced the immediate `useEffect` with a 300ms debounced version using `useRef` + `setTimeout`. Previous behavior fired on every keystroke; now waits for typing to pause before calling the API.

### Fix 3: Add result caching for ModelCapabilityBadge ✅
**File:** `web/src/api.ts`

Added a module-level `Map<string, { result, ts }>` cache with a 5-minute TTL to `fetchModelCapability()`. This prevents N parallel requests when multiple `ModelCapabilityBadge` components render simultaneously (one per provider table row). All callers benefit from the cache automatically.

### Fix 4: Add unit tests for model-capability.ts ✅
**File:** `backend/tests/prime-agent/model-capability.test.ts` (new, 31 tests)

Test coverage includes:
- **Known model matches**: Claude Sonnet → recommended, GPT-4o → recommended, Llama 8B → recommended, Llama 3B → warned, Gemma 2B → blocked, Qwen 0.5B → blocked, Qwen 7B → recommended (boundary), Phi 3.5 mini → warned, DeepSeek V3 → recommended, Mistral Large → recommended, Command-R+ → recommended
- **Unknown model fallback**: completely unknown name → warned with null params, whitespace-only → warned
- **Dynamic size extraction**: `my-custom-model-13b` → 13B recommended, decimal sizes (4.2B), space before b (`7 b`)
- **Boundary cases**: exactly 3B → not blocked (warned), exactly 7B → recommended, 2.9B → blocked, 6.9B → warned
- **Empty/null input**: empty string, null, whitespace-only → all return warned, not blocked
- **Case insensitivity**: GPT-4O, Llama-3.1-8B match correctly
- **No duplicate patterns**: verifies llama-3.1-70b returns correct result
- **Warning messages**: blocked mentions "minimum threshold" and "blocked from Prime", warned mentions "unreliable JSON" and "Recommended: 7B+", recommended has empty warning

### Fix 5: Add debouncing to Setup.tsx RoutingRow ✅
**File:** `web/src/pages/Setup.tsx`

Same 300ms debounce pattern applied to the `RoutingRow` component's model capability assessment `useEffect`. Moved `modelsKey` computation outside the effect to fix dependency array reference.

## Verification

```sh
cd backend && npx vitest run tests/prime-agent/model-capability.test.ts
# ✓ 31 tests passed in 12ms

cd web && npm run build
# ✓ built in 16.64s, no errors
```

## Files Changed

| File | Change |
|------|--------|
| `backend/src/prime-agent/model-capability.ts` | Removed duplicate Llama pattern |
| `backend/tests/prime-agent/model-capability.test.ts` | New: 31 unit tests |
| `web/src/api.ts` | Added TTL cache to fetchModelCapability |
| `web/src/pages/Providers.tsx` | Debounced model assessment in ProviderModal |
| `web/src/pages/Setup.tsx` | Debounced model assessment in RoutingRow |

## Not Addressed (Out of Scope)

- **Proprietary param estimates** (review concern #2): The estimated params for Claude Opus/Sonnet are rough but all correctly classified as `recommended`. Changing to `null` would lose useful info for users who do want to see approximate sizes. Left as-is with existing comments noting they're estimates.
- **Server-side save-time validation** (review concern #6): Adding validation at provider creation time is a separate feature that would require changes to the setup completion endpoint and provider CRUD routes. Noted as a potential follow-up.
