# Issue #25 Fixes — Review Feedback Addressed

## Changes Made

### Fix 1: Action Description Casing (`event-loop.ts`)
**Problem:** `reason[0].toLowerCase() + reason.slice(1)` always lowercased the first character, producing grammatically incorrect text when base ended with terminal punctuation (e.g., `"I'm done. delegate it"` instead of `"I'm done. Delegate it"`).

**Fix:** Check if `base` ends with `.`, `!`, or `?`. If so, capitalize the first action description. Subsequent descriptions stay lowercase.

```typescript
const baseEndsWithPunctuation = /[.!?]$/.test(base)
// ...
const shouldCapitalize = index === 0 && baseEndsWithPunctuation
return shouldCapitalize
  ? reason[0].toUpperCase() + reason.slice(1)
  : reason[0].toLowerCase() + reason.slice(1)
```

### Fix 2: Fallback Message Logging (`event-loop.ts`)
**Problem:** When `decision.response` is missing, the fallback `'I\'ve processed your request.'` was returned silently.

**Fix:** Added `console.warn('prime-agent: missing response in Prime decision, using fallback')` before returning the fallback.

### Fix 3: Conversation Transcript Truncation (`llm-router.ts`)
**Problem:** Hard `m.content.slice(0, 297) + '...'` cut mid-word or mid-sentence.

**Fix:** New `truncateAtBoundary()` function tries boundaries in order:
1. Paragraph break (`\n\n`) — best boundary
2. Sentence end (`. `, `! `, `? `) — good boundary
3. Word boundary (last space) — acceptable
4. Hard cut — last resort

Only cuts if the boundary is at least 40% into the max length to avoid tiny truncations.

### Fix 4: Remove Model Capability Import (`llm-router.ts`)
**Problem:** `llm-router.ts` imported `assessModelCapability` from `model-capability.js`, which only exists on the #26 branch. This caused test failures and would break if PR #27 merged without PR #28.

**Fix:** Removed the import and the model validation block from `createConfiguredLlmRouter()`. These belong to issue #26, not #25. The #26 PR will re-add this integration.

### Fix 5: Updated Tests (`event-loop.test.ts`)
- Updated existing test expectation: `"delegate it"` → `"Delegate it"` (base ends with `.`)
- Added new test: verifies lowercase when base does NOT end with terminal punctuation

## Verification

```sh
cd backend && npx vitest run tests/prime-agent/event-loop.test.ts tests/prime-agent/llm-router.test.ts tests/prime-agent/context.test.ts
# ✓ 3 test files passed, 21 tests passed
```

## Remaining Review Concerns (Not Fixed)
- **No retry on validation failure**: When `validatePrimeDecision` throws, error propagates without retry. Acceptable for now — would require architectural change.
- **Proprietary model param estimates**: Not applicable here (belongs to #26).

## Pushed To
`feature/issue-25-prime-chat-refinement` → PR #27
