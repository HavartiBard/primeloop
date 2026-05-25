# Data Model: Agentic Control Plane

## Goal

### Purpose
Represents a user-requested outcome owned by Prime and shown in the operator
control plane.

### Fields
- `id`: unique identifier
- `title`: short operator-facing goal name
- `intent`: full requested outcome in operator language
- `domain_summary`: one or more inferred domains involved in the goal
- `status`: lifecycle state for the goal
- `priority`: operator or Prime-assigned urgency level
- `requested_by`: operator identifier
- `owned_by_agent_role`: expected to be `prime`
- `current_summary`: latest operator-facing progress summary
- `result_summary`: final outcome summary when closed
- `risk_summary`: unresolved concerns or follow-up items
- `created_at`: creation timestamp
- `updated_at`: last modified timestamp
- `started_at`: execution start timestamp
- `completed_at`: completion timestamp when applicable
- `cancelled_at`: cancellation timestamp when applicable

### Validation Rules
- `title` and `intent` are required.
- `owned_by_agent_role` MUST remain `prime` for user-facing goals.
- `status` MUST be one of the supported lifecycle values.
- `completed_at` is required when `status` is `completed`.
- `cancelled_at` is required when `status` is `cancelled`.

### State Transitions
- `draft` → `queued`
- `queued` → `in_progress`
- `in_progress` → `awaiting_approval`
- `in_progress` → `blocked`
- `in_progress` → `completed`
- `in_progress` → `failed`
- `awaiting_approval` → `in_progress`
- `awaiting_approval` → `cancelled`
- `blocked` → `in_progress`
- `blocked` → `failed`
- any active state → `cancelled`

## Work Item

### Purpose
Represents a direct or delegated execution unit linked to a parent goal.

### Fields
- `id`: unique identifier
- `goal_id`: parent goal reference
- `parent_work_item_id`: optional reference for nested decomposition
- `assigned_agent_role`: Prime or specialist role handling the work
- `domain`: homelab, development, personal assistant, or cross-domain
- `title`: short work item label
- `scope`: operator-readable definition of the task
- `status`: lifecycle state
- `priority`: urgency or execution order
- `depends_on`: optional list of prerequisite work item identifiers
- `decision_summary`: latest Prime decision for this work item
- `outcome_summary`: final or current outcome
- `failure_reason`: reason for blocked/failed state when applicable
- `created_at`: creation timestamp
- `updated_at`: last modified timestamp
- `started_at`: execution start timestamp
- `completed_at`: completion timestamp when applicable

### Validation Rules
- `goal_id`, `assigned_agent_role`, `title`, and `status` are required.
- `assigned_agent_role` MUST be a supported role for the selected domain.
- `failure_reason` is required when `status` is `blocked` or `failed`.
- A work item cannot depend on itself.

### State Transitions
- `queued` → `in_progress`
- `in_progress` → `awaiting_approval`
- `in_progress` → `blocked`
- `in_progress` → `completed`
- `in_progress` → `failed`
- `awaiting_approval` → `in_progress`
- `blocked` → `retrying`
- `retrying` → `in_progress`
- `blocked` → `escalated`
- `escalated` → `in_progress`
- any active state → `cancelled`

## Agent Role

### Purpose
Represents an execution role available to Prime for direct work or delegation.

### Fields
- `id`: unique identifier
- `name`: role name
- `tier`: `prime`, `durable`, or `ephemeral`
- `domain_capabilities`: list of supported domains or task types
- `status`: availability state
- `description`: operator-readable role description
- `can_request_approval`: whether the role can trigger approval flow
- `created_at`: creation timestamp
- `updated_at`: last modified timestamp

### Validation Rules
- `name`, `tier`, and `status` are required.
- Exactly one active Prime role exists for the instance.
- Only Prime is user-facing for steering interactions.

## Approval

### Purpose
Represents an operator decision gate for high-impact or irreversible actions.

### Fields
- `id`: unique identifier
- `goal_id`: related goal reference
- `work_item_id`: optional related work item reference
- `requested_by_agent_role`: role requesting approval
- `action_summary`: description of the pending action
- `risk_summary`: why approval is needed
- `status`: pending, approved, rejected, expired, or cancelled
- `decision_notes`: optional operator rationale
- `expires_at`: approval expiry timestamp
- `resolved_at`: final decision timestamp
- `created_at`: creation timestamp

### Validation Rules
- `goal_id`, `requested_by_agent_role`, `action_summary`, and `status` are required.
- `decision_notes` SHOULD be captured for rejection when provided.
- `resolved_at` is required for approved, rejected, expired, or cancelled approvals.

## Recovery Event

### Purpose
Represents a failure detection and recovery or escalation action during execution.

### Fields
- `id`: unique identifier
- `goal_id`: related goal reference
- `work_item_id`: optional related work item reference
- `detected_condition`: blocked, failed, stalled, unavailable specialist, or similar
- `detected_at`: detection timestamp
- `severity`: operational impact level
- `selected_action`: retry, reroute, escalate, request approval, or stop
- `action_reason`: why that action was chosen
- `result_status`: succeeded, ongoing, failed, or escalated
- `result_summary`: operator-readable outcome
- `created_at`: creation timestamp

### Validation Rules
- `goal_id`, `detected_condition`, `detected_at`, `selected_action`, and
  `result_status` are required.
- `action_reason` is required when the selected action changes the original plan.

## Learning Record

### Purpose
Represents a reusable feedback artifact derived from a completed or failed goal.

### Fields
- `id`: unique identifier
- `goal_id`: related goal reference
- `work_item_id`: optional related work item reference
- `category`: planning, delegation, recovery, approval, UX, or domain-specific
- `signal_type`: success, failure, inefficiency, operator correction, or missed risk
- `observation`: what happened
- `recommendation`: what Prime should do differently next time
- `confidence`: low, medium, or high
- `applies_to_domains`: one or more related domains
- `created_at`: creation timestamp

### Validation Rules
- `goal_id`, `category`, `signal_type`, and `observation` are required.
- `recommendation` is required unless the record is informational only.

## Relationships
- One **Goal** has many **Work Items**.
- One **Goal** has many **Approvals**.
- One **Goal** has many **Recovery Events**.
- One **Goal** has many **Learning Records**.
- One **Work Item** may have many child **Work Items**.
- One **Work Item** may have zero or many **Approvals**, **Recovery Events**, and
  **Learning Records**.
- Many **Work Items** reference one **Agent Role** by assignment.
