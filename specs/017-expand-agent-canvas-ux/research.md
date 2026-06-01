# Research: Expand Agent Canvas UX

## Decision: Implement as a web-first UX expansion over existing ACP concepts

**Rationale**: The repository already exposes a React web surface under `web/` with pages for Circuit View, Live Feed, agents, approvals, goals, rooms, and runtime data. The requested scope is primarily an operator experience: richer chat event rendering, spatial canvas interaction, expandable cards, and a contextual bottom toolbar. Planning should therefore focus on the existing web application and reuse existing backend records and control endpoints where possible.

**Alternatives considered**:
- Add a separate standalone visualization surface: rejected because it duplicates existing navigation and increases maintenance cost.
- Make this a backend-first data-model feature: rejected because existing durable records already represent most requested concepts.

## Decision: Reuse existing runtime, goal, approval, delegation, and Prime session sources before adding durable schema

**Rationale**: Current backend modules already expose durable ACP concepts: goals, work items, approvals, delegations, agent registry, threads, runtime overview, Prime sessions, and control-plane events. The plan should compose these into UI view models for chat bubbles, cards, and canvas nodes. New persistence is not required for the MVP unless implementation discovers a missing source for notes or artifacts.

**Alternatives considered**:
- Create new chat event tables for every bubble type: rejected as premature because events can be derived from existing session, work item, approval, and delegation records.
- Store canvas layout coordinates per user: rejected because custom long-term layout persistence is out of scope for the spec.

## Decision: Model OpenSwarm-inspired chat as typed display events

**Rationale**: Operators need distinct, readable renderings for thinking, tool calls, tool results, context attachments, approvals, delegations, notes, goals, and artifacts. A typed display-event view model lets the web UI render consistent bubbles and cards while keeping ACP durable records as source of truth. The model can include status, actor, timestamp, summary, details, and attachments without requiring backend schema changes.

**Alternatives considered**:
- Render raw logs directly: rejected because raw logs do not meet the usability and accessibility requirements.
- Hard-code per-source rendering throughout pages: rejected because it would fragment status language and visual states.

## Decision: Expand the current circuit view with local pan, zoom, selection, and expandable cards

**Rationale**: `web/src/pages/CircuitView.tsx` already derives graph nodes and edges for Prime, agents, rooms, work items, delegations, and audit loops. Extending this surface with viewport state, selection state, and expanded cards is the simplest path that preserves existing data flow and visual language.

**Alternatives considered**:
- Introduce a new graph/canvas dependency immediately: rejected for YAGNI unless native interactions cannot satisfy acceptance criteria.
- Replace the current circuit layout wholesale: rejected because the current graph builder already encodes ACP relationships.

## Decision: Add a bottom action toolbar that routes steering actions through existing Prime/control-plane flows

**Rationale**: The constitution requires user intent to route through Prime and durable ACP records to remain the source of truth. Toolbar actions for spawning agents, tool calls, goals, artifacts, and notes should open focused composers that preserve the current chat/canvas context and submit through existing or planned ACP control contracts instead of becoming a separate command path.

**Alternatives considered**:
- Let toolbar actions mutate local UI state only: rejected because it would create ambiguous partial states and bypass durable records.
- Add all toolbar actions as independent backend endpoints: rejected unless existing Prime/control-plane endpoints cannot express a specific action.

## Decision: Verification focuses on web component tests, interaction tests, and backend contract tests only where contracts change

**Rationale**: The web package already uses Vitest, Testing Library, and jsdom. The backend uses Vitest and route tests. The highest-risk behavior is user interaction, accessibility, state rendering, and contract compatibility, so tests should cover chat event rendering, canvas pan/zoom/expand behavior, toolbar flows, and any added or changed API/event contract.

**Alternatives considered**:
- Only manual visual QA: rejected because requirements call for testable behavior and regressions would be easy.
- Full browser E2E as a hard requirement: deferred unless existing tooling supports it; component-level interaction tests can cover the planned MVP.

---

## Clarification-driven decisions (2026-05-26)

### R-C1: Pointer event model for pan/drag

**Decision**: `onPointerDown`/`onPointerMove`/`onPointerUp` on the canvas container div with `element.setPointerCapture(e.pointerId)` on drag start. Calls existing `useCanvasViewport.panBy(dx, dy)` — no new hook state needed. Reject if `e.button !== 0` to avoid interfering with right-click.

**Alternatives considered**: react-use `useDrag` (adds dependency), HTML5 drag API (no touch), SVG viewBox (requires full rewrite of CSS-transform approach).

### R-C2: Pinch-to-zoom and scroll-to-zoom

**Decision**: `onWheel` on the canvas container for scroll-to-zoom (`zoomBy(delta < 0 ? 1.1 : 0.9, cx, cy)`). `onTouchStart`/`onTouchMove` for two-finger pinch using `Math.hypot` distance delta. Apply `touch-action: none` to the canvas container to suppress browser scroll interference.

**Alternatives considered**: `GestureEvent` (Safari-only), PointerEvent coalescedEvents (not widely supported for pinch).

### R-C3: Toolbar placement inside canvas viewport

**Decision**: Render `BottomActionToolbar` as `position: absolute; bottom: 1rem; left: 50%; transform: translateX(-50%); z-index: 10` inside the canvas wrapper div (which is already `position: relative; flex: 1; overflow: hidden`). This naturally scopes the toolbar to the canvas area and never overlaps the sidebar.

### R-C4: Canvas card-position persistence

**Decision**: New `canvas_layouts` table `(canvas_key TEXT DEFAULT 'default', card_id TEXT, x FLOAT, y FLOAT, updated_at TIMESTAMPTZ, PRIMARY KEY (canvas_key, card_id))`. New `useCanvasLayout` hook loads positions on mount, saves on drag-end debounced 500ms. New routes `GET/PUT /api/canvas/layout`.

**Alternatives considered**: localStorage (not portable, lost on clear), per-card metadata on agent/thread records (couples layout to domain records).

### R-C5: Goal → Room auto-creation

**Decision**: Extend `POST /api/control-plane/goals` to also: (1) create a `threads` row with `metadata: { kind: 'goal-room', goal_id }`, (2) insert the goal title as the first thread message, (3) enqueue a `prime_queue_items` row of type `goal_created` with `{ goal_id, thread_id }`. Prime's existing cron loop processes it and recruits agents. Response includes `thread_id` so the frontend can navigate to the new room immediately.

**Alternatives considered**: Separate POST /rooms endpoint (extra round-trip, extra surface), WebSocket push directly to Prime (requires Prime to be running at creation time).

### R-C6: Live agent-join visualization

**Decision**: Prime posts thread messages with `metadata: { agent_joined: true, agent_id }` when recruiting. Frontend listens on existing SSE `/events` stream; when a matching event arrives, the canvas adds the agent card with a CSS `opacity 0→1` fade-in (200ms, no JS animation library). react-query refetch of thread messages handles the chat side.

**Alternatives considered**: Canvas polling (wastes requests), new WebSocket per room (too heavy for this scope).
