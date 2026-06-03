# Contract: Permission Policy & Approval Bridge

Governs how `session/request_permission` is resolved (spec FR-005, FR-006a, SC-003).

## Decision flow

```
request_permission(toolCall, options)
  └─ classify(toolCall) → low_risk | sensitive   (default: sensitive when uncertain)
       ├─ low_risk  → auto-select an "allow_once" option, no approval item
       └─ sensitive → create approval-queue item, block turn
            ├─ operator approves → select "allow_once" (or "allow_always")
            ├─ operator denies   → select "reject_once" (or "reject_always")
            ├─ timeout (timeoutMs) → select "reject_once"  (FAIL-SAFE DENY)
            └─ task cancelled     → respond { outcome: "cancelled" }
```

## Classification inputs
- `toolCall.name` against `lowRiskTools` (e.g., read/list within sandbox).
- `toolCall.input` paths: in-sandbox vs out-of-sandbox (out → sensitive).
- Destructive / network / mutation intents → sensitive.
- Anything not confidently low-risk → **sensitive (default gate)**.

## Option mapping (ACP `PermissionOptionKind`)
Operator decision → choose the matching `optionId` from the agent-supplied `options`:
| Decision | Preferred kind (fallback) |
|---|---|
| approve once | `allow_once` |
| approve always | `allow_always` (→ `allow_once`) |
| deny | `reject_once` |
| deny always | `reject_always` (→ `reject_once`) |
| timeout | `reject_once` |
| cancelled | `{ outcome: "cancelled" }` |

If the agent did not offer a matching kind, fall back to the closest available option of the same
allow/deny polarity; if none, respond `cancelled` and fail the gated action safely.

## Approval-queue integration (reuse spec 008)
- Sensitive request → existing approval-queue item with `pending` → `approved`/`denied` states.
- The bridge resolves the blocked ACP request when the queue item transitions.
- Item carries `sessionId`, `toolCall` summary, and correlation (`delegation_id`/`work_item_id`).

## Configuration
Per-agent via `agents.config` (+ capability-profile `approval_rules` defaults):
`{ lowRiskTools: string[], sensitivePatterns: rule[], default: "gate", timeoutMs: number }`.

## Observability
- Each decision emits a `runtime_event` (classification + outcome) for diagnosis (SC-007).
- Auto-resolved low-risk decisions are logged but do not create approval items.
