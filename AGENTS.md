# Agent Control Plane Instructions

This repository is delegated to local OpenCode agents for narrow implementation tasks.

## Default Mode

- Prefer small, file-scoped changes.
- Do not refactor unrelated code.
- Do not modify files outside the task scope.
- If the task provides an exact schema or exact field list, copy it exactly.
- If the task is ambiguous, stop and report the ambiguity instead of guessing.

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

## Completion

When the task is done, output exactly this block and nothing else:

```
TASK COMPLETE
Changed: <list of changed files, or "none">
Verification: <command run and result, or "none">
```

After outputting TASK COMPLETE:
- Make no further tool calls.
- If you receive any further prompt, respond with a single empty line and nothing else.
- Do not summarize, ask what to do next, or generate a Goal/Progress template.
- Silence is the correct response after TASK COMPLETE.

