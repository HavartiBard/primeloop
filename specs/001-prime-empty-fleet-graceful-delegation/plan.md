# Implementation Plan: Prime Empty Fleet Graceful Degradation

**Branch**: `001-prime-empty-fleet-graceful-delegation` | **Date**: 2026-05-21 | **Spec**: [spec.md](./spec.md)

## Summary

Prime agent gets stuck when the fleet has zero agents because its profile mandates delegation but no valid targets exist. Fix involves: (1) making the empty-fleet condition explicit in the system prompt, (2) updating Prime's standing rules to handle this case, and (3) adding a runtime guard in the action dispatcher that prevents null-target delegations.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20+
**Primary Dependencies**: Express, pg (PostgreSQL), @anthropic-ai/sdk, openai
**Storage**: PostgreSQL (runtime state), local filesystem (workspace templates)
**Testing**: Existing test infrastructure in `backend/src/__tests__/`
**Target Platform**: Linux server (Unraid Docker container)
**Project Type**: Backend web service with LLM orchestration
**Performance Goals**: No additional latency for the empty-fleet path
**Constraints**: Must not break existing delegation flow when agents ARE available; Phase A scope only
**Scale/Scope**: Single Prime agent, 0-N fleet agents

## Constitution Check

*GATE: Project constitution is a blank template — no gates to check.*

## Project Structure

### Documentation (this feature)

```text
specs/001-prime-empty-fleet-graceful-delegation/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (from /speckit.tasks)
```

### Source Code Changes

```text
backend/
├── src/
│   ├── prime-agent/
│   │   ├── llm-router.ts      # formatLines for agents: explicit empty-fleet message
│   │   └── actions.ts         # dispatchDelegate: null-target guard → no_op + pending work item
├── prompts/
│   ├── agents/
│   │   └── prime.md           # Add empty-fleet fallback guidance
│   └── policies/
│       └── standing-rules.md  # Add "no agents available" handling rule
```

**Structure Decision**: All changes are within existing files. No new files or directories required. This is a focused fix to existing prompt templates and runtime guards.

## Phase 0: Research Findings

### R-1: Current empty-fleet rendering
- `llm-router.ts` line ~237: `formatLines(context.fleet.agents.map(...))` produces `- none` when fleet is empty (from the `lines.length > 0 ? lines.join('\n') : '- none'` fallback)
- The LLM sees `- none` under "## Fleet Agents" which is ambiguous — could mean "no agents matched this query" rather than "the fleet is completely empty"

### R-2: Current delegation dispatch behavior
- `actions.ts` `selectTargetAgent()` returns `undefined` when no agent matches
- `dispatchDelegate()` passes `targetAgent?.id` (which is `undefined`) to `createDelegation()`
- The delegation is created with `to_agent_id: null` — it exists but has no owner
- No error is raised; the delegation silently goes unassigned

### R-3: Current profile/standing rules
- `agents/prime.md`: "When the user gives me a task, I evaluate the smallest delegation that completes it" — no exception for empty fleet
- `policies/standing-rules.md`: "Prefer bounded delegation with clear ownership and verification" — no fallback guidance

## Phase 1: Design

### Changes Required

#### Change 1: Explicit empty-fleet indicator in system prompt (FR-002, SC-003)

**File**: `backend/src/prime-agent/llm-router.ts`

In `buildPrimeSystemPrompt()`, the `agents` template variable currently uses:
```typescript
agents: formatLines(context.fleet.agents.map(
  (a) => `- ${a.name} [${(a.capabilities as string[]).join(', ')}]${a.enabled ? '' : ' (disabled)'}`,
)),
```

When `context.fleet.agents.length === 0`, `formatLines` returns `- none`. Change to an explicit message:

```typescript
agents: context.fleet.agents.length > 0
  ? formatLines(context.fleet.agents.map(...))
  : '(no agents available — respond directly to the user)',
```

Also update `formatLines` to handle the empty case more explicitly (or handle it inline as above).

#### Change 2: Runtime guard against null-target delegation (FR-001, SC-002)

**File**: `backend/src/prime-agent/actions.ts`

In `dispatchDelegate()`, after `selectTargetAgent()` returns, check if `targetAgent` is undefined:

```typescript
const targetAgent = selectTargetAgent(ctx, capability, requestedTargetId)

if (!targetAgent) {
  // No eligible agent — create a pending work item and return no_op instead
  const workItem = await createWorkItem(pool, {
    title,
    description,
    status: 'pending',
    lane: 'operations',
    owner_label: coordinatorName,
    thread_id: threadId,
    metadata: {
      source: 'prime-agent',
      action_type: 'pending_delegation',
      capability,
      reason: `No agent available with capability '${capability}'`,
      requested_target_id: requestedTargetId ?? null,
    },
  })

  await insertRuntimeEvent(pool, { ... })

  return {
    action: { type: 'no_op', payload: action.payload, reason: `Cannot delegate: no agent available for capability '${capability}'. Work item ${workItem.id} created in pending state.` },
    status: 'dispatched',
    work_item: workItem,
  }
}
```

This converts the would-be `delegate` action into a `no_op` with a tracked work item.

#### Change 3: Update Prime profile for empty-fleet guidance (FR-005)

**File**: `backend/prompts/agents/prime.md`

Add to Default Behaviors section:
```markdown
- When no fleet agents are available, respond directly to the user and track the
  work item as pending. Do not attempt delegation when the agent list is empty.
```

#### Change 4: Update standing rules (FR-005)

**File**: `backend/prompts/policies/standing-rules.md`

Add:
```markdown
- When no agents are available, handle requests directly or create pending work items. Never delegate to a null target.
```

### Data Model

No schema changes required. Existing `work_items` table supports `status: 'pending'` and the `metadata` JSON column stores capability and reason.

### Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| All agents disabled | Treated same as empty fleet — `selectTargetAgent` filters by capabilities only, not enabled status. Consider filtering by `enabled` in a follow-up. |
| Mixed: some agents available but none match capability | `selectTargetAgent` returns undefined → same guard applies → pending work item created |
| Agent added mid-conversation | Next cron cycle processes pending items; no special handling needed in this fix |

## Complexity Tracking

N/A — no constitution violations.
