# Data Model: Expand Agent Canvas UX

## Overview

This feature primarily introduces web-facing view models derived from existing ACP records. Durable ACP records remain authoritative for goals, work items, approvals, delegations, agents, rooms/threads, Prime sessions, artifacts, notes, and events. The web layer composes these records into typed chat events, canvas items, and toolbar action states.

## Entity: ChatDisplayEvent

**Purpose**: Normalized display item for the expanded chat timeline.

**Fields**:
- `id`: Stable event identifier derived from the source record and event type.
- `kind`: One of `message`, `thinking`, `tool_call`, `tool_result`, `context_attachment`, `approval`, `delegation`, `goal`, `artifact`, `note`, `system`.
- `actorLabel`: Human-readable actor such as Prime, an agent name, system, or operator.
- `status`: One of `pending`, `streaming`, `running`, `success`, `failed`, `cancelled`, `timeout`, `blocked`, `resolved`, `unavailable`.
- `occurredAt`: Timestamp used for timeline ordering.
- `summary`: Concise text shown in the collapsed bubble or card.
- `details`: Optional longer detail shown when expanded.
- `source`: Source type and source identifier for traceability to durable records.
- `attachments`: Zero or more `ContextAttachment` references.
- `actions`: Zero or more available user decisions or follow-up actions.

**Relationships**:
- May reference one goal, work item, Prime session, approval, delegation, tool invocation, artifact, note, room, or agent.
- May include many context attachments.

**Validation Rules**:
- Every display event must have `id`, `kind`, `status`, `occurredAt`, `summary`, and `source`.
- Restricted or unavailable content must be represented by status and summary without exposing hidden details.
- Tool-call events should pair with result events when a result exists; missing results remain visible as pending or timed out.

**State Transitions**:
- Thinking: `streaming` → `success` | `failed` | `cancelled`.
- Tool call/result: `pending` → `running` → `success` | `failed` | `timeout` | `cancelled`.
- Approval: `pending` → `resolved` | `cancelled` | `timeout`.
- Delegation: `pending` → `running` → `success` | `failed` | `blocked` | `cancelled`.

## Entity: ContextAttachment

**Purpose**: Visible reference to context connected to a chat event, card, or toolbar action.

**Fields**:
- `id`: Stable attachment identifier.
- `name`: Display name.
- `type`: One of `file`, `artifact`, `goal`, `work_item`, `message`, `tool_result`, `note`, `link`, `other`.
- `sourceLabel`: Human-readable source.
- `availability`: One of `available`, `restricted`, `deleted`, `too_large`, `loading`, `error`.
- `previewSummary`: Optional short preview or reason unavailable.
- `targetRef`: Reference to the item to open or inspect.

**Relationships**:
- Belongs to one chat display event, card, or toolbar draft.

**Validation Rules**:
- Must show name, type, source, and availability even when the target cannot be opened.
- Restricted attachments must not expose hidden content in preview summaries.

## Entity: ApprovalDisplayCard

**Purpose**: Actionable display of an approval request.

**Fields**:
- `id`: Approval identifier.
- `requesterLabel`: Actor requesting approval.
- `requestSummary`: Requested action or decision.
- `rationale`: Optional rationale or risk summary.
- `urgency`: Optional urgency or deadline label.
- `status`: `pending`, `approved`, `rejected`, `cancelled`, or `expired`.
- `decisionOptions`: Available decisions for pending approvals.
- `decidedBy`: Optional decision maker label.
- `decidedAt`: Optional decision timestamp.

**Relationships**:
- References the related goal, work item, tool call, room, or agent when available.

**Validation Rules**:
- Pending cards must show available decisions.
- Resolved cards must show the final decision state.

## Entity: DelegationDisplayCard

**Purpose**: Display delegated or assigned work in chat and canvas.

**Fields**:
- `id`: Delegation identifier.
- `sourceLabel`: Delegating agent or system.
- `targetLabel`: Target agent or room.
- `objective`: Delegated objective.
- `status`: `pending`, `queued`, `running`, `blocked`, `completed`, `failed`, or `cancelled`.
- `resultSummary`: Optional result or latest status summary.
- `relatedWorkRef`: Optional linked work item.

**Relationships**:
- References source agent, target agent or room, and optional work item.

**Validation Rules**:
- Cards must show both source and target when known.
- Missing targets must be represented as unavailable rather than hidden.

## Entity: CircuitCanvasView

**Purpose**: Spatial operating picture for ACP agents, rooms, work, and relationships.

**Fields**:
- `viewport`: Pan offset, zoom level, and selected item identifier.
- `nodes`: Collection of `CircuitNode` items.
- `edges`: Collection of `CircuitEdge` relationships.
- `densityState`: `empty`, `normal`, `crowded`, or `overflow`.
- `status`: `loading`, `ready`, `error`, or `empty`.

**Relationships**:
- Contains many nodes and edges.

**Validation Rules**:
- Empty and error states must provide next actions or recovery guidance.
- Viewport state is local UI state unless later requirements explicitly add persistence.

## Entity: CircuitNode

**Purpose**: Spatial card or node representing an ACP object.

**Fields**:
- `id`: Stable node identifier.
- `type`: `prime`, `agent`, `room`, `work_item`, `approval`, `delegation`, `artifact`, `note`, or `system`.
- `title`: Display title.
- `summary`: Short status summary.
- `status`: Shared status category such as active, running, blocked, approval, neutral, or system.
- `position`: Canvas position.
- `collapsedDetails`: Summary chips shown by default.
- `expandedDetails`: Additional details shown when expanded.
- `relatedRefs`: References to durable source records.

**Relationships**:
- May connect to many other nodes through circuit edges.
- Agent and room nodes may expose related chat events and pending approvals.

**Validation Rules**:
- Every node must be readable at default zoom.
- Expanded details must not require navigation away from the canvas.

## Entity: CircuitEdge

**Purpose**: Visible relationship between circuit nodes.

**Fields**:
- `id`: Stable edge identifier.
- `fromNodeId`: Source node.
- `toNodeId`: Target node.
- `relationship`: `coordinates`, `participates`, `owns`, `delegates`, `requests_approval`, `produces`, or `references`.
- `status`: Optional status reflected from the relationship.

**Validation Rules**:
- Edges must not obscure node labels at default zoom.
- Relationship labels or styling must remain consistent across similar relationships.

## Entity: BottomToolbarAction

**Purpose**: Context-preserving operator action initiated from chat or canvas.

**Fields**:
- `id`: Local action draft identifier until persisted item exists.
- `actionType`: `spawn_agent`, `tool_call`, `create_goal`, `capture_artifact`, or `add_note`.
- `originContext`: Current room, chat event, canvas item, selected agent, selected goal, or viewport.
- `requiredInputs`: Inputs needed before submission.
- `status`: `draft`, `submitting`, `succeeded`, `failed`, or `cancelled`.
- `createdRef`: Reference to the created durable item when successful.
- `errorSummary`: Optional error message.

**Relationships**:
- May create or reference an agent, tool invocation, goal, artifact, or note.
- Must link completed items back to the originating context.

**Validation Rules**:
- Cancelling a draft must create no durable item.
- Successful actions must produce a visible linked result in chat and/or canvas.
- Actions that steer work must route through Prime or existing ACP control flows.

---

## New Durable Entities (added by clarifications 2026-05-26)

## Entity: canvas_layouts (DB table)

**Purpose**: Persists operator-defined card positions on the circuit canvas across sessions.

**Fields**:
- `canvas_key` TEXT NOT NULL DEFAULT 'default' — single-tenant canvas identifier
- `card_id` TEXT NOT NULL — matches the node `id` in CircuitCanvasView
- `x` FLOAT NOT NULL DEFAULT 0
- `y` FLOAT NOT NULL DEFAULT 0
- `updated_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- PRIMARY KEY (canvas_key, card_id)

**Relationships**:
- `card_id` informally references agent, thread, goal, or work-item IDs. No FK enforced (layout survives deleted items; stale entries are ignored on load).

**Validation Rules**:
- Upserted on drag-end (debounced 500ms). Never blocks the UI on save failure.
- Loaded on canvas mount; missing entries use auto-layout positions.

## Entity: GoalRoom (goal → thread binding)

**Purpose**: When a goal is created, a thread is automatically created as its persistent workspace. Stored in the existing `threads` table.

**Fields** (additional thread metadata):
- `metadata.kind`: `'goal-room'`
- `metadata.goal_id`: ID of the originating goal

**Relationships**:
- One goal has at most one goal-room thread.
- The thread starts with Prime as first participant; additional agents are added by Prime via thread messages with `metadata.agent_joined = true`.

**Validation Rules**:
- Goal creation is not considered complete until thread row is committed (same DB transaction).
- If thread creation fails, the goal creation request must return an error; no partial goal row should be left visible to the frontend.

## Entity: AgentJoinEvent (thread message subtype)

**Purpose**: Signals that Prime has recruited an agent into a goal-room, used by the canvas to animate the agent card appearing.

**Fields** (thread_messages.metadata):
- `agent_joined`: `true`
- `agent_id`: ACP agent ID
- `agent_name`: Display name

**Relationships**:
- One per recruited agent, posted to the goal-room thread by Prime.
- Triggers canvas card appearance on the frontend via SSE event stream.

**Validation Rules**:
- Only Prime may post `agent_joined` messages.
- `agent_id` must reference a valid agents row at time of posting.
