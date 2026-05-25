# Progress

## Status
In Progress

## Plan: 2026-05-21-prime-agent-profile (12 tasks)

| # | Task | Status |
|---|------|--------|
| 1 | Profile parser/renderer + section constants (TDD) | — |
| 2 | Ship the rich default templates | ✅ Done |
| 3 | Workspace loader recognizes both files | ✅ Done |
| 4 | System prompt template includes the soul block | ✅ Done |
| 5 | Profile API endpoints (GET / PUT / PATCH) | ✅ Done |
| 6 | Setup endpoint accepts structured profile (legacy-compatible) | ⏳ Pending |
| 7 | `update_profile` action handler | ⏳ Pending |
| 8 | System prompt documents the new action and onboarding tour | ⏳ Pending |
| 9 | Onboarding greeting includes profile synopsis | ⏳ Pending |
| 10 | Frontend types and API client | ⏳ Pending |
| 11 | Wizard Personality step rewrite | ⏳ Pending |
| 12 | End-to-end manual verification | ⏳ Pending |

## Files Changed (Task 2)
- Created: `backend/prompts/agents/prime-soul.md` — rich soul template (Identity, Voice & Tone, Decision Style)
- Overwritten: `backend/prompts/agents/prime.md` — operating profile (Default Behaviors, Approval Thresholds)
- Created: `backend/tests/prime-agent/profile-defaults.test.ts` — parser round-trip tests for both templates

## Notes
- Task 1 committed as `92ecdf7` on `feature/conversation-first-workflow`.
- Task 2 committed as `4e71977` on `feature/conversation-first-workflow`.
- Both soul and operating templates parse cleanly with zero unknown headings and all sections >50 chars.
- Task 3 committed as `6747758` on `feature/conversation-first-workflow`.
- Task 4 committed as `0d912e7` on `feature/conversation-first-workflow`.
- Task 5 committed as `c5bbedf` on `feature/conversation-first-workflow`.
