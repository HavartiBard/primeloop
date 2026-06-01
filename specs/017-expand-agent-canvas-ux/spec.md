# Feature Specification: Expand Agent Canvas UX

**Feature Branch**: `017-expand-agent-canvas-ux`

**Created**: 2026-05-25

**Status**: Done

**Input**: User description: "Expand Agent Control Plane chat and circuit canvas UX using OpenSwarm-inspired patterns: streaming thinking bubbles, tool-call/result bubbles, visible context attachments, approval/delegation cards, spatial pan/zoom circuit canvas, expandable agent/room cards, and bottom-toolbar actions for spawning agents, tool calls, goals, artifacts, and notes."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Understand live agent activity in chat (Priority: P1)

An operator monitors an active agent conversation and can see thinking progress, tool calls, tool results, attached context, and approval or delegation requests as distinct, readable chat elements instead of a single undifferentiated transcript.

**Why this priority**: Live comprehension of agent activity is the core value of the expanded chat experience and reduces operator uncertainty during automation.

**Independent Test**: Can be fully tested by opening an active or replayed agent conversation containing thinking updates, tool activity, context attachments, approvals, and delegations, then confirming each event type is visible, distinct, and understandable without inspecting raw logs.

**Acceptance Scenarios**:

1. **Given** an agent is producing interim reasoning or status updates, **When** the operator opens the chat, **Then** the chat shows streaming thinking bubbles that clearly indicate ongoing work and update as new content arrives.
2. **Given** an agent invokes a tool and receives a result, **When** the tool event appears in chat, **Then** the operator sees a tool-call bubble followed by a result bubble with outcome state, summary, and enough details to decide whether action is needed.
3. **Given** a message includes files, artifacts, prior messages, goals, or other context, **When** the message is rendered, **Then** the context attachments are visible as named attachments with type, source, and expansion affordance.
4. **Given** an agent requests approval or delegates work, **When** the request appears, **Then** the operator sees a card that clearly communicates what is being requested, who requested it, available actions, and current status.

---

### User Story 2 - Navigate the circuit canvas spatially (Priority: P2)

An operator explores the agent control plane as a spatial circuit, using pan and zoom to understand relationships between agents, rooms, work items, context, and activity flows.

**Why this priority**: A spatial canvas turns complex multi-agent activity into an inspectable operating picture and supports faster orientation than linear lists alone.

**Independent Test**: Can be fully tested by opening a circuit with multiple agents and rooms, panning and zooming across the canvas, expanding cards, and confirming relationships and status remain readable at different scales.

**Acceptance Scenarios**:

1. **Given** a circuit contains multiple agents, rooms, and active work, **When** the operator opens the circuit canvas, **Then** the canvas presents these items as spatial cards with visible relationships and current states.
2. **Given** the operator pans or zooms the canvas, **When** the viewport changes, **Then** orientation is preserved and the operator can continue selecting and reading visible items.
3. **Given** an agent or room card is collapsed, **When** the operator expands it, **Then** the card reveals additional relevant details such as participants, current activity, recent outputs, pending approvals, and context without navigating away.
4. **Given** the circuit has no active work or no agents, **When** the operator opens the canvas, **Then** the canvas shows a helpful empty state with clear next actions.

---

### User Story 3 - Take common control actions from the bottom toolbar (Priority: P3)

An operator uses a persistent bottom toolbar to start new work, spawn specialist agents, initiate tool calls, capture artifacts, and add notes from the chat or canvas without losing context. Creating a new Goal is the primary entry point: it opens a modal, then automatically creates a Room seeded with Prime, who recruits or spawns further agents as needed.

**Why this priority**: Fast access to common actions makes the control plane operational, not merely observational, while keeping the operator anchored in the current workspace.

**Independent Test**: Can be fully tested by using each toolbar action from both chat-focused and canvas-focused contexts and confirming the resulting item is created, linked to the current context, and visible where expected.

**Acceptance Scenarios**:

1. **Given** the operator is viewing a chat or circuit, **When** they open the bottom toolbar, **Then** actions are available for New Goal (primary), Spawn Agent, Tool Call, Artifact, and Note.
5. **Given** the operator selects New Goal, **When** they complete the modal with a title and description, **Then** the system creates a Room, adds Prime as the first participant, posts the goal as the opening message, and the Room appears on the circuit canvas; Prime subsequently assigns or spawns supporting agents into that Room.
2. **Given** the operator starts a toolbar action, **When** the action requires input, **Then** the interface presents a focused composer or form that preserves the current chat or canvas context.
3. **Given** the operator completes a toolbar action, **When** the action succeeds, **Then** the new agent, tool call, goal, artifact, or note appears in the relevant chat and/or canvas context with a clear success state.
4. **Given** the operator cancels a toolbar action, **When** they return to the workspace, **Then** no partial item is created and their previous viewport or conversation position is preserved.

---

### Edge Cases

- When thinking, tool, approval, or delegation events arrive out of order, the interface must preserve a coherent timeline and clearly indicate pending or delayed results.
- When a tool call fails, times out, or returns a large result, the result bubble must show a concise failure or summary state with an option to inspect details.
- When context attachments are unavailable, deleted, or too large to preview, the attachment must remain visible with an explanation and safe fallback.
- When many agents or rooms are present, the canvas must remain navigable and avoid overlapping or unreadable cards at default zoom.
- When the operator uses keyboard navigation or assistive technology, chat bubbles, cards, canvas controls, and toolbar actions must remain discoverable and operable.
- When the viewport is small, the bottom toolbar and expanded cards must not obscure critical chat or canvas content without an obvious way to dismiss or resize them.

## Constitution Alignment *(mandatory)*

- **Code Quality Plan**: Maintain correctness and readability by defining each visible event type, card state, and toolbar action with independently testable behavior and by reusing existing product terminology for agents, rooms, goals, artifacts, notes, approvals, and tools.
- **YAGNI Check**: New visible UX patterns are required now because the requested experience introduces distinct chat bubbles, spatial navigation, expandable cards, and contextual toolbar actions; speculative automation rules, marketplace integrations, and multi-tenant customization are out of scope.
- **Reliability & Operations**: The experience must expose clear loading, streaming, success, failure, timeout, and stale-data states; operational issues must be diagnosable from user-visible statuses and existing monitoring without requiring raw transcript inspection.
- **UX Consistency**: Primary flows must use consistent labels and states across chat and canvas, including thinking, tool call, tool result, context, approval, delegation, agent, room, goal, artifact, and note; empty, loading, success, error, and cancellation states must be explicit.
- **Design Consistency**: The feature should reuse existing visual hierarchy, spacing, typography, status colors, card patterns, and action affordances where possible, adding new patterns only for the requested stream bubbles, spatial canvas controls, expandable cards, and bottom toolbar.
- **ACP Architecture Constraints**: No architectural change is required by this specification; the feature presents and controls existing Agent Control Plane concepts while preserving Prime routing, durable records, isolation boundaries, and single-tenant assumptions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST display streaming thinking or progress updates as distinct chat bubbles with an in-progress state and a completed state.
- **FR-002**: The system MUST display tool calls as distinct chat bubbles that identify the requested tool action, requesting agent, current status, and time of request.
- **FR-003**: The system MUST display tool results as distinct chat bubbles that identify success, failure, cancellation, or timeout and provide a concise human-readable summary.
- **FR-004**: Users MUST be able to expand chat bubbles for thinking, tool calls, and tool results to inspect additional details when available.
- **FR-005**: The system MUST display context attachments on relevant messages with visible name, type, source, availability, and an affordance to inspect or open the attachment.
- **FR-006**: The system MUST display approval requests as actionable cards showing requester, requested action, rationale or summary, available decisions, deadline or urgency when available, and final decision state.
- **FR-007**: The system MUST display delegation requests or assignments as cards showing source agent, target agent or room, delegated objective, status, and resulting outcome when available.
- **FR-008**: The system MUST preserve readable chronological context when streaming events, tool results, approvals, and delegations update over time.
- **FR-009**: The system MUST provide a circuit canvas where Rooms are the top-level spatial entities. The canvas is room-centric: Prime and other agents are shown as participants within a Room card, not as standalone canvas nodes. The canvas MUST have a pre-seeded Welcome Room visible when no user goals exist yet. New Room cards MUST be placed automatically using a loose grid/flow layout on creation. Operators MUST be able to drag cards to preferred positions, and those positions MUST be persisted across sessions. Room cards MUST use a two-state collapsed/expanded design inspired by OpenSwarm's AgentCard: header row with status chip, last-message preview in collapsed state, full embedded chat in expanded state, color-coded status borders (green=active, orange=awaiting approval, gray=idle/done, red=error), and spring animation on creation.
- **FR-010**: Users MUST be able to pan and zoom the circuit canvas while retaining access to orientation cues and selected item context. Pan is activated by click-and-drag (mouse) or touch-drag (mobile/tablet); zoom is activated by scroll-wheel (mouse) or pinch gesture (touch). No separate pan-mode toggle is required.
- **FR-011**: Users MUST be able to select and expand agent cards to view current status, active or recent work, relevant context, pending approvals, and recent outputs.
- **FR-012**: Users MUST be able to select and expand room cards to view participants, active goals or work, recent activity, shared context, and pending decisions.
- **FR-013**: The system MUST provide helpful empty, loading, error, and overflow states for the chat event stream and the circuit canvas.
- **FR-014**: The system MUST provide a persistent bottom toolbar with actions for New Goal (primary), Spawn Agent, Tool Call, Artifact, and Note. The toolbar MUST be visible on both the circuit canvas and the rooms/chat view. On the circuit canvas it MUST be rendered inside the canvas viewport area and MUST NOT overlap the sidebar navigation menu.
- **FR-021**: **New Goal** is the primary entry point for starting work. When an operator selects New Goal, the system MUST present a modal prompting for goal title, description, and optional context. On confirmation, the system MUST automatically create a Room associated with that goal, add the Prime agent as the first participant, and post the goal intent as the opening message. Prime then evaluates the goal and decides which additional agents to assign or spawn to support the work. The new Room MUST appear immediately on the circuit canvas.
- **FR-022**: Rooms are created implicitly by the New Goal flow and MUST NOT require a separate "New Room" action. A Room represents the persistent workspace for a goal — its conversation history, participants, shared context, and outputs. When more agents are needed, Prime adds them to the existing room rather than creating a new one. The Room card MUST appear on the circuit canvas immediately after goal submission, before Prime has finished recruiting agents.
- **FR-024**: When Prime evaluates a new goal, its agent-selection reasoning MUST stream as thinking bubbles inside the Room's chat in real time. As each agent is assigned or spawned, that agent's card MUST appear on the circuit canvas and join the Room card visually, so the operator can watch the team assemble without navigating away.
- **FR-023**: Spawn Agent from the toolbar is a power-user action for explicitly creating a specialist agent that Prime can later route work to. It does not automatically create a room or goal. The spawned agent appears on the circuit canvas in an unassigned state until Prime assigns it to a room.
- **FR-015**: Toolbar actions MUST preserve the current chat or canvas context and link newly created items back to that context when the action completes.
- **FR-016**: Users MUST be able to cancel toolbar actions without creating partial items or losing their current chat position or canvas viewport.
- **FR-017**: The system MUST make all new chat bubbles, cards, canvas controls, and toolbar actions operable through keyboard navigation and understandable to assistive technologies.
- **FR-018**: The system MUST avoid exposing sensitive hidden content by default; detailed thinking, tool results, or attachments that are restricted or unavailable must show an appropriate summary or access state instead.
- **FR-019**: The system MUST use consistent status language and visual state categories across chat bubbles, cards, canvas nodes, and toolbar-created items.
- **FR-020**: The system MUST support replay or inspection of completed activity so users can review prior thinking updates, tool calls, results, approvals, delegations, attachments, and canvas states.

### Key Entities *(include if feature involves data)*

- **Chat Event**: A visible conversation item such as a thinking update, tool call, tool result, approval request, delegation, context attachment, note, goal update, artifact reference, or standard message; key attributes include event type, actor, status, timestamp, summary, details, and related context.
- **Context Attachment**: A visible reference to supporting material connected to a chat event, card, or toolbar action; key attributes include name, type, source, availability, preview state, and related event or workspace.
- **Approval Card**: An actionable representation of a decision request; key attributes include requester, requested action, rationale or summary, decision options, urgency, status, decision maker, and outcome.
- **Delegation Card**: A representation of assigned or transferred work; key attributes include source, target, objective, status, linked work, and result summary.
- **Circuit Canvas**: A spatial workspace representing agents, rooms, relationships, and activity states; key attributes include viewport, selected item, cards or nodes, relationships, and display density.
- **Agent Card**: A canvas item representing an agent; key attributes include identity, role, current state, recent activity, linked context, pending approvals, and outputs.
- **Room Card**: A canvas item representing the persistent workspace for a goal; automatically created when a goal is submitted. Key attributes include the originating goal, participants (starting with Prime), activity timeline, shared context, pending decisions, and outputs. Rooms grow to include additional agents as Prime assigns or spawns them.
- **Toolbar Action**: A contextual action initiated from the bottom toolbar; key attributes include action type, initiating user, originating context, required inputs, completion status, and created item. New Goal is the primary creation action; Spawn Agent, Tool Call, Artifact, and Note are secondary actions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In usability testing, at least 90% of operators can correctly identify whether an agent is thinking, calling a tool, waiting for approval, delegating work, or finished within 10 seconds of viewing the relevant chat section.
- **SC-002**: At least 90% of operators can locate and open a referenced context attachment from a chat message or card without assistance.
- **SC-003**: At least 85% of operators can navigate from an overview of a circuit with 20 visible agents or rooms to a specific agent or room detail within 30 seconds.
- **SC-004**: At least 90% of toolbar action attempts result in either a clearly created linked item or an explicit cancellation/failure state, with no ambiguous partial state.
- **SC-005**: Operators can complete each primary toolbar action from an existing chat or canvas context in under 60 seconds during acceptance testing.
- **SC-006**: Accessibility review confirms that all new controls and information states are reachable by keyboard and have understandable names, roles, and states.
- **SC-007**: User feedback from pilot review shows at least 80% agreement that the expanded chat and canvas make agent activity easier to understand than the prior experience.

## Clarifications

### Session 2026-05-26

- Q: What should the primary pan interaction be on the circuit canvas? → A: Click-and-drag to pan (mouse), touch-drag to pan (mobile/tablet), scroll-wheel to zoom, pinch-to-zoom on touch. No separate pan-mode toggle.
- Q: Where should the bottom toolbar be visible? → A: Both circuit canvas and rooms/chat view. On canvas it must render inside the canvas viewport and must not overlap the sidebar navigation menu.
- Q: How should new rooms be created and what is the primary workflow to start new work? → A: New Goal is the primary entry point. Submitting a goal via a modal automatically spawns a Room with Prime as first participant; Prime decides what agents to recruit or spawn into that room. Rooms are never created directly. Spawn Agent is a separate power-user action for creating specialists without immediately starting work.
- Q: How much of Prime's agent-selection process should be visible on canvas when a goal is submitted? → A: Fully live — room card appears on canvas immediately, Prime's reasoning streams as thinking bubbles in the room chat, and each agent card appears on canvas as it is assigned. Operator watches the team assemble in real time.
- Q: How should Room cards be spatially arranged when multiple rooms are active? → A: Auto-placed on creation using a loose grid/flow layout; operator can drag cards to preferred positions; positions are persisted across sessions.
- Q: Should the Prime agent be shown as a top-level entity on the circuit canvas? → A: No. Prime is not a standalone node on the canvas. The canvas is room-centric: only Room cards appear as top-level entities. Prime participates inside rooms (visible in the room's participant list and chat) but is not rendered as a separate card at the canvas level.
- Q: What is the initial canvas state when no goals have been created yet? → A: The canvas shows a pre-seeded "Welcome Room" as its first visible element. This room acts as an onboarding entry point — it is always present and guides the operator toward creating their first goal. The welcome room uses the same Room card design as any other room.
- Q: What visual design pattern should Room cards use? → A: Mimic OpenSwarm's AgentCard pattern: two-state collapsed/expanded card with a header row (drag handle, room title, status chip, close/navigate button), a chat preview showing the last message (first ~120 chars) with an animated pulse dot when streaming, color-coded border and status chip (green=active, orange=awaiting approval, gray=idle/done, red=error), snap-to-24px-grid drag, and spring animation on creation. Expanded state embeds the full chat interface.

## Assumptions

- The target users are operators or builders already using Agent Control Plane to monitor and steer agent work.
- OpenSwarm-inspired means adopting comparable interaction patterns and information architecture, not copying branding or proprietary assets.
- Existing Agent Control Plane concepts for agents, rooms, goals, artifacts, notes, tool calls, approvals, delegations, and context remain the source of truth.
- The feature focuses on presentation and operator controls for existing concepts; new autonomous decision policies are out of scope.
- Detailed internal reasoning or sensitive content may need summarization or access gating according to existing product rules.
- Existing design system patterns, status terminology, and durable records will be reused where possible.
- Multi-user collaboration conflicts are out of scope. Canvas layout persistence (card positions) is in scope for single-tenant use.
