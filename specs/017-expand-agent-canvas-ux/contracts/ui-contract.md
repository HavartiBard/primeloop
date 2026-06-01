# UI Contract: Expanded Chat, Circuit Canvas, and Bottom Toolbar

## Scope

This contract describes user-visible behavior and view-model expectations for the Agent Control Plane web experience. It does not require a new public external API by itself; implementations should satisfy this contract using existing durable ACP records and only add backend contracts where a toolbar action cannot be expressed by existing Prime or control-plane flows.

## Chat Timeline Contract

### ChatDisplayEvent

Each rendered chat item must provide:

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Stable display event identifier. |
| `kind` | Yes | Message, thinking, tool call, tool result, context attachment, approval, delegation, goal, artifact, note, or system. |
| `actorLabel` | Yes | Prime, agent, system, or operator label. |
| `status` | Yes | Pending, streaming, running, success, failed, cancelled, timeout, blocked, resolved, or unavailable. |
| `occurredAt` | Yes | Timestamp used for ordering. |
| `summary` | Yes | Collapsed human-readable summary. |
| `details` | No | Expanded details, if allowed and available. |
| `attachments` | No | Visible context attachment references. |
| `actions` | No | Allowed decisions or follow-up actions. |

### Required Rendering Behavior

- Thinking events render as streaming bubbles while active and retain a completed state after finishing.
- Tool calls render separately from tool results.
- Tool results clearly distinguish success, failure, cancellation, and timeout.
- Context attachments are visible on the relevant bubble or card even when unavailable.
- Approval and delegation events render as cards with status, involved actors, and relevant actions.
- Out-of-order updates preserve a coherent timeline and make pending or delayed results obvious.
- Restricted details remain summarized and are not exposed by default.

## Circuit Canvas Contract

### CircuitCanvasView

The canvas must provide:

| Field | Required | Description |
|-------|----------|-------------|
| `viewport` | Yes | Current pan offset, zoom level, and selected item. |
| `nodes` | Yes | Spatial cards or nodes for Prime, agents, rooms, work, approvals, delegations, artifacts, notes, or system items. |
| `edges` | Yes | Relationships between nodes. |
| `status` | Yes | Loading, ready, empty, or error. |
| `densityState` | Yes | Empty, normal, crowded, or overflow. |

### Required Interaction Behavior

- Users can pan the canvas by click-and-drag (mouse) or touch-drag (touch/tablet); scroll-wheel zooms on desktop; two-finger pinch zooms on touch. No separate pan-mode toggle required.
- Pan and zoom do not interfere with the sidebar navigation — the toolbar and canvas controls render inside the canvas viewport area only.
- Users can select nodes through pointer and keyboard interaction.
- Agent and room cards can expand to reveal current activity, recent outputs, context, and pending decisions.
- Card positions can be changed by dragging; positions are persisted and restored on next load.
- New Room cards auto-place at a computed grid position on creation; they appear immediately without waiting for agents to join.
- Empty states provide next actions (primary: "New Goal").
- Error states explain what failed and how to retry or recover.
- Default layout must keep common labels readable and avoid unusable overlap.

## New Goal Flow Contract

Creating a Goal is the primary entry point for all new work.

### Modal Inputs

| Field | Required | Description |
|-------|----------|-------------|
| `title` | Yes | Short description of the goal (≤200 chars) |
| `description` | No | Additional context or success criteria |

### Required Behavior

1. Operator opens "New Goal" from bottom toolbar (canvas or rooms/chat view).
2. A focused modal opens; current canvas viewport or chat position is preserved.
3. On submit, the system creates a Goal record AND a Thread (goal-room) in a single operation.
4. The Room card appears on the canvas immediately; Prime is shown as the first participant.
5. Prime's reasoning about agent selection streams as thinking bubbles inside the room's thread.
6. As Prime recruits each agent, a new agent card appears on the canvas with a fade-in transition.
7. On cancel, no records are created and the operator returns to their prior context.
8. On failure, a concise error is shown inline in the modal with retry affordance.

### API Contract: Create Goal with Room

```
POST /api/control-plane/goals
Request:  { title: string, description?: string, priority?: string, metadata?: object }
Response: { id: string, title: string, status: string, thread_id: string, created_at: string }
```

`thread_id` is new — it must be present in every success response so the frontend can navigate to the room immediately.

## Bottom Toolbar Contract

### Actions

The toolbar must expose these actions from both canvas and rooms/chat contexts. On canvas it must render inside the canvas viewport and must not overlap the sidebar.

| Action | Priority | Required Result |
|--------|----------|-----------------|
| New Goal | Primary | Opens goal modal; creates goal + room; Prime recruits agents. |
| Spawn agent | Secondary | Creates or requests an agent through ACP steering path; links to current context. |
| Tool call | Secondary | Creates or requests a tool call; links result to current context. |
| Capture artifact | Secondary | Captures or references an artifact linked to current context. |
| Add note | Secondary | Creates a note linked to current context. |

### Required State Behavior

- Opening an action preserves the current chat position or canvas viewport.
- Draft actions are cancellable without creating partial durable items.
- Submitting shows a clear in-progress state.
- Success shows the created item in the relevant chat and/or canvas context.
- Failure shows a concise, actionable error and allows retry or cancellation.
- Steering actions must route through Prime or existing ACP control-plane flows, not a parallel control path.

## Accessibility Contract

- New bubbles, cards, canvas controls, and toolbar actions must be reachable by keyboard.
- Interactive elements must expose understandable names, roles, and states.
- Streaming, loading, success, failure, and pending updates must be understandable without relying only on color.
- Focus should remain predictable when expanding cards, opening toolbar composers, cancelling actions, or changing canvas selection.

## Observability Contract

- User-visible failure states must map to diagnosable operational states.
- Tool failures, missing attachments, failed action submissions, and canvas data-load failures must produce actionable summaries for operators and enough implementation-level signal for diagnosis during development and operation.
