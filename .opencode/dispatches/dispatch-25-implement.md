# Dispatch: Implement Issue #25 — Refine Prime Chat Response Process

**Role:** Implementer
**Model:** qwen/qwen3-coder-next
**Issue:** https://code.klsll.com/HavartiBard/agent-control-plane/issues/25

## Dispatch Instructions

Read `.opencode/agents/dispatch-instructions.md` for your behavior contract. You are the **implementer**.

## Issue #25 Summary

Refine Prime's chat response process for conversational quality and visibility. Six change areas:

### A. Transient reasoning visibility
- Emit intermediate WebSocket events during module execution (especially decision stage)
- Frontend shows transient thinking indicator, swaps to final response when ready
- Reasoning never becomes a permanent chat message

### B. Response contract enforcement
- `response` is always required and validated for user-facing (`prime.message`) events
- Fix contradictory instructions in `request.md`
- Clarify field boundaries in `system.md`

### C. Natural action descriptions
- Replace raw action type listing with natural language from action `reason` fields
- Refactor `presentPrimeResponse()` in event-loop.ts

### D. Conversational thread context
- Format thread messages as dialogue with speaker attribution
- Increase message limit from 8 to 15-20
- Preserve turn structure for multi-agent threads

### E. Prompt tiering for model capability
- Full prompt for capable models, condensed-but-complete for constrained models
- Raise `n_predict` minimum from 128 to 512
- Never truncate mid-instruction

### F. Response validation
- Reject decisions where `response` is empty on user-facing events
- Minimum quality check: > 10 chars, no internal schema labels

## Files to Read First

- `.opencode/agents/dispatch-instructions.md` (your behavior contract)
- `backend/src/prime-agent/event-loop.ts`
- `backend/src/prime-agent/llm-router.ts`
- `backend/src/prime-agent/context.ts`
- `backend/src/prime-agent/modules/types.ts`
- `backend/src/prime-agent/modules/registry.ts`
- `backend/prompts/prime/system.md`
- `backend/prompts/prime/request.md`
- `web/src/components/CollaborationRoomsView.tsx`
- `web/src/api.ts`
- `web/src/types.ts`
- `web/src/hooks/useWebSocket.ts`

## Allowed Files (edit only these)

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

## Verification

```sh
cd backend && npm run test
cd web && npm run build
```
