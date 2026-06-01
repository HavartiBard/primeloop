# Agent Control Plane Instructions

This repository is delegated to local OpenCode agents for both focused implementation tasks and larger end-to-end execution plans.

## Default Mode

- Prefer complete solutions over artificially narrow slices when a task clearly spans multiple files, layers, or phases.
- Build and execute a coherent plan when the user asks for issue completion, end-to-end implementation, or a complex feature.
- Group related changes into a single task when they are part of the same user goal and can be completed safely together.
- Prefer small, file-scoped changes when they are sufficient, but do not stop at an intermediate slice if the broader task is still unfinished.
- Do not refactor unrelated code.
- Do not modify files outside the task scope.
- If the task provides an exact schema or exact field list, copy it exactly.
- If the task is ambiguous, stop and report the ambiguity instead of guessing.
- When a task is large, finish the full requested scope whenever feasible:
  - implement the required code changes
  - update the relevant API/UI/contracts
  - run the requested verification
  - identify and close obvious follow-on gaps that are necessary for the requested feature to function coherently
- Do not split work into multiple turns unless:
  - the user explicitly wants phased delivery
  - a missing decision blocks safe implementation
  - the remaining work requires credentials, approvals, or external context you do not have

## Prime Agent Work

For Prime Agent implementation tasks:

- Prime is a native backend service, not an `agents` table row.
- Do not build on the older OpenCode Prime-as-worker design.
- Do not use `is_prime` as the implementation basis for the new Prime Agent.
- Keep Phase A limited to the exact schema, routing, queue, and service steps described in the current plan.

## Migration Rules

When editing `backend/src/db.ts`:

- Keep migrations idempotent.
- Add only the tables, columns, indexes, and seed rows explicitly requested.
- Do not invent extra indexes.
- Do not redesign table shapes.
- Preserve existing unrelated migrations.

## Verification

- Run only the verification command requested in the task.
- Report changed files and the verification result.
- If verification fails, report the failure clearly and do not hide it.
- If no verification command is requested, do not invent one solely for process reasons.

<!-- SPECKIT START -->
Current Speckit plan: `specs/019-inline-chat-artifacts/plan.md`
<!-- SPECKIT END -->
