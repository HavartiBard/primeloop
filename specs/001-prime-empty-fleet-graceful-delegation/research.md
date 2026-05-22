# Research: Prime Empty Fleet Graceful Degradation

## Decision: Guard location for null-target delegation

**Decision**: Add the guard in `dispatchDelegate()` within `actions.ts`, not in `selectTargetAgent()` itself.

**Rationale**: Keeping `selectTargetAgent()` as a pure lookup function preserves its simplicity. The dispatch layer is the correct place to decide what happens when no target exists — it has access to the pool, context, and coordinator name needed to create a fallback work item.

**Alternatives considered**:
- Throwing from `selectTargetAgent()` — would require try/catch in every caller and loses the ability to create a pending work item inline
- Guarding at the LLM output validation layer — too late; the decision is already made, and we'd lose the context needed for a meaningful work item

## Decision: Empty-fleet message format

**Decision**: Use `'(no agents available — respond directly to the user)'` as the agents section text.

**Rationale**: This is unambiguous to the LLM — it states both the fact (no agents) and the expected behavior (respond directly). The parenthetical format matches the existing style used elsewhere in the prompt (e.g., `(disabled)` suffix on agents).

**Alternatives considered**:
- A separate prompt section — adds complexity for a single-line change
- A JSON flag in context — would require changing the template structure

## Decision: Pending work item status

**Decision**: Use `status: 'pending'` with `metadata.action_type: 'pending_delegation'`.

**Rationale**: The `work_items` table already supports arbitrary string statuses. Using `'pending'` distinguishes these from `'active'` items that are being worked on. The `action_type` metadata allows filtering and later processing by a cron handler.

**Alternatives considered**:
- Using `status: 'blocked'` with `blocked_by: 'no_agent'` — semantically correct but would require adding a blocked_by column if it doesn't exist
- Creating a delegation row with null target — this is what currently happens and is the bug we're fixing
