# Dispatch: Review Issue #25 Implementation

**Role:** Reviewer
**Model:** qwen3.6-35b-a3b
**Issue:** https://code.klsll.com/HavartiBard/agent-control-plane/issues/25

## Dispatch Instructions

Read `.opencode/agents/dispatch-instructions.md` for your behavior contract. You are the **reviewer**.

## What to Review

The implementer has made changes to address Issue #25: "Refine Prime chat response process for conversational quality and visibility."

Review all changed files against the acceptance criteria in the issue:

### Acceptance Criteria Checklist

- [ ] Prime always produces a clean user-facing `response` field for chat messages
- [ ] Internal `reasoning` never appears in the permanent chat transcript
- [ ] Users see a transient thinking indicator while Prime processes their message
- [ ] Action descriptions are natural language, not raw type strings
- [ ] Thread context is formatted as a conversation with speaker attribution
- [ ] Small models receive a complete (not truncated) prompt with adequate output budget
- [ ] Response validation rejects empty or low-quality responses on user-facing events
- [ ] All existing tests pass

### Per-Section Review

For each proposed change (A through F in the issue):
- Was it implemented in the correct files?
- Does it match the described behavior?
- Are there leftover TODOs or incomplete implementations?
- Do existing tests still pass?

### Scope Check

Flag any edits to files outside the allowed list:
- `backend/src/prime-agent/event-loop.ts`
- `backend/src/prime-agent/llm-router.ts`
- `backend/src/prime-agent/context.ts`
- `backend/prompts/prime/system.md`
- `backend/prompts/prime/request.md`
- `web/src/components/CollaborationRoomsView.tsx`
- `web/src/api.ts`
- `web/src/types.ts`
- `web/src/hooks/useWebSocket.ts`
- `backend/tests/prime-agent/llm-router.test.ts`
- `backend/tests/prime-agent/event-loop.test.ts`

## Files to Read

- `.opencode/agents/dispatch-instructions.md` (your behavior contract)
- `https://code.klsll.com/HavartiBard/agent-control-plane/issues/25` (full issue spec)
- All files listed in the allowed files list above

## Verification

Run after review:
```sh
cd backend && npm run test
cd web && npm run build
```

## Report Format

Lead with **PASS** or **FAIL**.
List exact mismatches.
Flag out-of-scope edits.
State whether verification was run and its result.
