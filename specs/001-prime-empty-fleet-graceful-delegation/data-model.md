# Data Model: Prime Empty Fleet Graceful Degradation

No schema changes required. This feature uses existing tables and columns.

## Existing Entities Used

### work_items

Used for tracking undeliverable tasks when fleet is empty.

| Column | Type | Usage in this feature |
|--------|------|----------------------|
| `id` | uuid | Unique work item ID |
| `title` | text | Task title from the delegation request |
| `description` | text | Task description |
| `status` | text | Set to `'pending'` for undeliverable tasks |
| `lane` | text | Set to `'operations'` |
| `owner_label` | text | Set to coordinator name |
| `metadata` | jsonb | Stores `{ source: 'prime-agent', action_type: 'pending_delegation', capability, reason }` |
| `thread_id` | text (nullable) | Original thread if from a user message |

### runtime_events

Used for logging the no_op action with reason.

| Column | Type | Usage in this feature |
|--------|------|----------------------|
| `event_type` | text | Set to `'prime.action.no_op'` |
| `actor` | text | Coordinator name |
| `payload` | jsonb | Stores `{ reason, payload }` from the action |

### agents (fleet)

Read-only — used by `selectTargetAgent()` to find matching agents. When empty, triggers the fallback path.
