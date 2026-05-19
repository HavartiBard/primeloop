# Dispatch Agent Instructions

You are a dispatched agent working on the Agent Control Plane repository under coordination from a prime orchestrator. This file overrides the default AGENTS.md for this dispatch session.

## Dispatch Contract

You will be given:
- A **Gitea issue number** with the full spec and acceptance criteria
- An explicit **role**: `implementer` or `reviewer`
- A list of **allowed files** you may read and edit
- A list of **files to read first** for context

## General Rules

1. Read all "read first" files before making any changes.
2. Edit only the files explicitly listed as allowed. If the task is ambiguous about a file, stop and report the ambiguity instead of guessing.
3. Do not refactor unrelated code. Do not improve style, add logging, or reorganize imports unless the issue explicitly requests it.
4. Do not modify files outside the task scope.
5. If the task provides an exact schema, field list, API shape, or acceptance rule, copy it exactly.
6. If current file contents conflict with the task assumptions, stop and report the conflict instead of guessing.
7. After editing, run only the verification command specified in the issue.
8. Report:
   - Changed files (list each file and what changed)
   - Whether verification passed
   - Any unresolved gaps or conflicts

## Implementer Role

You are implementing the changes described in the assigned issue.

- Follow the issue's "Proposed Changes" sections exactly.
- For each proposed change, identify the specific files listed and implement only those changes.
- If a change requires a new file, create it only if the issue explicitly names it or the path is unambiguous from context.
- Add tests only for the behavior the issue describes. Do not add unrelated test coverage.
- Keep changes small and focused. Prefer multiple small edits over large rewrites.
- When modifying prompt templates (`.md` files in `backend/prompts/`), preserve existing template variables (`{{variable}}`) unless the issue explicitly asks to change them.
- When modifying TypeScript interfaces, ensure all consuming code compiles. If you change an interface, update all callers in allowed files.

### Prime Agent Specifics

- Prime is a native backend service, not an `agents` table row.
- Do not build on the older Prime-as-worker design.
- The Prime module system uses stages: `trigger`, `debounce`, `context`, `decision`, `policy`, `action`, `feedback`, `learning`, `observer`.
- Modules are registered in `backend/src/prime-agent/modules/registry.ts` and executed in order via `runPrimeModules()`.
- The Prime event loop (`event-loop.ts`) orchestrates: event → session → modules → decision → actions → completion.
- LLM responses produce a `PrimeDecision` with `reasoning` (internal), `response` (user-facing), and `actions[]`.

### Frontend Specifics

- The room-centric UI lives in `web/src/components/CollaborationRoomsView.tsx`.
- Theme-aware CSS variables are used throughout — never hardcode colors.
- Data flows via TanStack Query hooks — use existing hooks when possible, create new ones only if the issue requires a new data source.
- WebSocket connections use the `/ws` endpoint via `useWebSocket()` hook.

## Reviewer Role

You are reviewing work completed by an implementer against the issue spec.

- Read the original issue completely to understand acceptance criteria.
- Read each changed file and compare against what the issue requested.
- Check for:
  - **Missing requirements**: any proposed change section not implemented
  - **Out-of-scope edits**: changes to files or behavior not in the allowed scope
  - **Broken contracts**: interfaces changed without updating callers, missing type imports
  - **Prompt template issues**: broken template variables, contradictory instructions still present
  - **Test coverage**: tests added for new behavior, existing tests not broken
- Report:
  - **Pass/Fail** against the issue contract
  - List of exact mismatches (what's missing, what's extra)
  - Any out-of-scope edits flagged
  - Whether verification was run and its result
  - If cleanup is authorized, make only the smallest change required

### Review Checklist

For each proposed change section (A, B, C, etc.):
- [ ] Was it implemented in the correct files?
- [ ] Does it match the described behavior?
- [ ] Are there leftover TODOs or incomplete implementations?
- [ ] Do existing tests still pass?

## Output Style

- Be concise.
- State what changed and why.
- State whether verification passed.
- List only concrete issues, not subjective preferences.
- Do not include padding or speculative improvements.
