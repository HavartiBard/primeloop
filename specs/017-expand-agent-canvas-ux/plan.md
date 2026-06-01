# Implementation Plan: Expand Agent Canvas UX

**Branch**: `017-expand-agent-canvas-ux` | **Date**: 2026-05-26 | **Spec**: [spec.md](./spec.md)

## Summary

Extend the existing circuit canvas and rooms/chat views with: (1) pointer-event-driven pan/drag and pinch-to-zoom on the canvas, (2) the bottom action toolbar mounted inside the canvas viewport (not overlapping the sidebar), (3) a "New Goal" modal as the primary work-creation entry point that auto-creates a room seeded with Prime, (4) live agent-join visualization as Prime streams its reasoning and recruits agents, and (5) canvas card-position persistence so operators can arrange the canvas and return to it.

The foundation is already partially in place: `useCanvasViewport` has `panBy`/`zoomBy` logic but no pointer handlers wired; `BottomActionToolbar` exists but is only mounted in `CollaborationRoomsView`; goals exist in the control-plane API but do not auto-create a room. This plan wires the missing connections.

## Technical Context

**Language/Version**: TypeScript 5.x (React 18, Node.js 20 / Express)

**Primary Dependencies**: React, Vite, Tailwind CSS, @tanstack/react-query, vitest, @testing-library/react (frontend); Express, pg, node-cron (backend). No new dependencies required.

**Storage**: PostgreSQL (existing ACP DB). One new table: `canvas_layouts` for persisting card positions. Goals/threads/rooms use existing tables.

**Testing**: vitest + @testing-library/react (frontend); vitest + supertest (backend)

**Target Platform**: Web browser, desktop primary (pointer events), touch secondary (pinch/touch events)

**Project Type**: Web application — frontend React SPA + Express REST backend

**Performance Goals**: Canvas pan/zoom at native pointer rate (no debounce); toolbar action modal opens in <100ms; goal creation round-trip <500ms

**Constraints**: Toolbar must render inside the canvas viewport and must not overlap the sidebar nav. Canvas positions persisted per single-tenant instance. No new npm dependencies.

**Scale/Scope**: Single-tenant; canvas expected to hold 5–50 cards comfortably. No pagination needed.

## Constitution Check

**Code quality**: All new interaction logic goes into the existing `useCanvasViewport` hook (pointer handler additions) and a new `useCanvasLayout` hook (position persistence). No new components created beyond `NewGoalModal`. Existing `BottomActionToolbar` is reused unchanged. Failure paths (goal creation error, layout save failure) are handled explicitly with visible error states.

**YAGNI**: No new abstractions beyond what the accepted scope requires. `canvas_layouts` table is the minimum viable persistence. No multi-canvas, no undo/redo, no animation library. Touch support uses native pointer events — no gesture library.

**SRE readiness**: Backend goal-creation endpoint already logs; canvas layout endpoint uses a simple upsert with no side effects. Layout save failures are non-critical (logged, UI shows stale indicator). New DB migration is additive-only (`CREATE TABLE IF NOT EXISTS`). No new cron jobs or background processes.

**UX consistency**: New Goal modal reuses existing `INPUT_CLS`/`LABEL_CLS` patterns and the existing modal overlay pattern from the codebase. Canvas toolbar positioning follows the same bottom-anchored pattern already used in `CollaborationRoomsView`. Empty canvas state uses the existing "no data" card pattern.

**Visual polish**: Toolbar on canvas is identical component to rooms view — no style divergence. New Goal modal uses established form patterns. Agent cards appearing on canvas use existing `CircuitNodeCard` with a brief fade-in (CSS transition only, no JS animation library).

**ACP architecture constraints**: Goal creation routes through `POST /api/control-plane/goals` then notifies Prime via the existing prime queue. Prime remains the sole agent-selection decision-maker. Canvas layout is UI state stored in the DB for persistence, not authoritative work state.

## Project Structure

### Documentation (this feature)

```text
specs/017-expand-agent-canvas-ux/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/           ← Phase 1 output
└── tasks.md             ← Phase 2 output (/speckit-tasks)
```

### Source Code

```text
web/src/
├── hooks/
│   ├── useCanvasViewport.ts     ← extend: add pointer/touch/wheel handlers
│   └── useCanvasLayout.ts       ← NEW: card position load/save/optimistic update
├── components/
│   └── agentCanvas/
│       ├── NewGoalModal.tsx      ← NEW: goal title + description modal
│       └── index.ts             ← export NewGoalModal
├── pages/
│   └── CircuitView.tsx          ← extend: wire pan/zoom events, mount toolbar, mount NewGoalModal
└── api.ts                       ← extend: fetchCanvasLayout, saveCanvasLayout

backend/src/
├── db.ts                        ← extend: canvas_layouts table migration
├── routes/
│   ├── control-plane.ts         ← extend: goal creation triggers room + Prime notify
│   └── canvas.ts                ← NEW: GET/PUT /api/canvas/layout
└── app.ts                       ← mount canvas router

web/tests/
├── hooks/
│   └── useCanvasViewport.test.ts  ← extend: pointer/touch handler tests
├── components/
│   └── NewGoalModal.test.tsx      ← NEW
└── pages/
    └── CircuitView.canvas.test.tsx ← NEW: toolbar presence, drag interaction

backend/tests/
└── canvas.route.test.ts           ← NEW: layout GET/PUT
```

## Complexity Tracking

No constitutional violations. All extensions use existing infrastructure.

---

## Phase 0: Research

### R-001: Pointer event model for pan/drag

**Decision**: Use `pointer events` (`onPointerDown`, `onPointerMove`, `onPointerUp`) on the canvas container div, with `setPointerCapture` on drag start. This handles mouse and touch with one code path and avoids the ghost-drag issue from `mousedown`.

**Rationale**: The existing `useCanvasViewport` hook already has `panBy(dx, dy)` — the only missing piece is wiring pointer events that call it. No library needed.

**Alternatives considered**: `useDrag` from react-use (adds dependency), SVG viewBox manipulation (requires rewriting the existing CSS-transform approach), HTML5 drag API (doesn't support touch).

### R-002: Pinch-to-zoom

**Decision**: Listen for `wheel` events for scroll-to-zoom (already partially wired in `CircuitCanvasControls`), and use `onTouchStart`/`onTouchMove` with two-finger distance delta for pinch-to-zoom calling `zoomBy`.

**Rationale**: Pointer events don't expose pinch distance — touch events are needed specifically for the two-finger case. Mouse scroll is handled by `wheel` event on the container.

**Alternatives considered**: `GestureEvent` (Safari only), `PointerEvent` with coalescedEvents (not widely supported for pinch).

### R-003: Toolbar inside canvas viewport, no sidebar overlap

**Decision**: Position the toolbar `absolute bottom-4 left-1/2 -translate-x-1/2` inside the canvas wrapper div (which is already `relative overflow-hidden` and sits to the right of the sidebar). This naturally constrains it to the canvas area.

**Rationale**: The canvas wrapper already handles its own coordinate space. Positioning the toolbar inside it rather than at the page level ensures it never overlaps the sidebar regardless of sidebar width.

### R-004: Canvas layout persistence

**Decision**: Single `canvas_layouts` table with `(canvas_key TEXT, card_id TEXT, x FLOAT, y FLOAT)` and a composite PK. `canvas_key = 'default'` for the single-tenant case. Frontend fetches on mount, saves on drag-end (debounced 500ms).

**Rationale**: Simplest viable persistence. No versioning needed for single-tenant. Debounce prevents write amplification during rapid repositioning.

**Alternatives considered**: localStorage (lost on clear, not portable), per-agent metadata column (couples layout to agent records).

### R-005: Goal → Room auto-creation flow

**Decision**: Extend `POST /api/control-plane/goals` to: (1) insert the goal, (2) create a `thread` with `metadata: { kind: 'goal-room', goal_id }`, (3) post the goal title as the first thread message from `sender: 'operator'`, (4) enqueue a Prime queue item of type `goal_created` with the goal_id and thread_id. Prime's existing cron loop picks it up and processes it.

**Rationale**: Reuses existing thread, thread_messages, and prime_queue_items infrastructure. No new event bus needed. Prime's queue is already the integration point for operator-initiated work.

**Alternatives considered**: WebSocket push directly to Prime (requires Prime to be running at creation time), separate `rooms` table (redundant with threads).

### R-006: Live agent-join visualization

**Decision**: Frontend polls `GET /api/threads/:id/messages` (already exists via react-query with a short refetch interval) for the goal room's thread. When a new agent is mentioned in a thread message with `metadata.agent_joined`, the circuit canvas adds that agent's card. Cards use a CSS `opacity 0→1 transition` (200ms) on mount.

**Rationale**: Avoids adding a new WebSocket subscription. The existing event stream (`/events` SSE) also carries thread message events — that can be used as the trigger for zero-polling feel.

**Alternatives considered**: New WebSocket channel per room (too heavy for this scope), full re-fetch of agent list (loses the "appearing one by one" effect).

---

## Phase 1: Design & Contracts

*(See generated artifacts below)*
