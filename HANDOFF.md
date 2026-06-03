# Handoff

## Current direction

**Spec 017 — Expand Agent Canvas UX** is the active work stream. The canvas is being rebuilt as a room-centric spatial workspace. The rooms/chat sidebar view remains as the primary detail view; the circuit canvas is the spatial overview.

The canvas UX is now:
- **Room-centric**: only Room cards appear as top-level entities on the canvas. Prime is not a standalone node.
- **OpenSwarm-style cards**: two-state collapsed/expanded RoomCard with header (drag handle, status dot, title, status chip, expand toggle, navigate arrow), collapsed body (last activity preview), expanded body (work item list + open room link).
- **Welcome room**: a pre-seeded room (`kind='welcome'`) is always present as the initial canvas state before any goals are created.
- **Goal creation**: "New Goal" modal from the bottom toolbar creates a room + thread automatically.

## Recent work (this session)

### Bugs fixed
1. **`transitionGoalStatus` off-by-one bug** — `paramIndex` was incremented to 3 before use, causing `WHERE id = $3` with only 2 bound parameters. PostgreSQL reported "could not determine data type of parameter $2". Fixed by removing the spurious `paramIndex++` (`backend/src/goals/service.ts:250`).
2. **JSONB type inference** — `threads` INSERT now uses `jsonb_build_object()` instead of passing a JSON string for the metadata column. `prime_queue_items` INSERT uses `$2::jsonb` cast. (`backend/src/routes/control-plane.ts`, `backend/src/checkpoint-store.ts`).

### Canvas redesign
- `web/src/pages/CircuitView.tsx` fully rewritten: room-centric, RoomCard component, snap-to-grid, grid layout, empty state.
- Removed: Prime node, standalone agent nodes, edge legend, `agentRegistry`/`healthData` queries.
- Added: Welcome room seed in `backend/src/db.ts`.

## Key files

| File | Purpose |
|------|---------|
| `web/src/pages/CircuitView.tsx` | Circuit canvas — room-centric spatial view |
| `web/src/hooks/useCanvasViewport.ts` | Pan/zoom state hook (drag, pinch, wheel) |
| `web/src/hooks/useCanvasLayout.ts` | Persisted card positions hook |
| `web/src/hooks/useExpandableItems.ts` | Expandable item state hook |
| `web/src/components/agentCanvas/` | Canvas components (BottomActionToolbar, NewGoalModal, etc.) |
| `web/src/components/CollaborationRoomsView.tsx` | Rooms sidebar + chat detail view |
| `web/src/pages/Setup.tsx` | Setup wizard (providers, LLM router, prime config) |
| `backend/src/routes/control-plane.ts` | Goal creation, approvals API |
| `backend/src/routes/canvas.ts` | Canvas layout persistence API |
| `backend/src/goals/service.ts` | Goal state machine |
| `backend/src/db.ts` | DB migrations + seeds (welcome room, canvas_layouts) |
| `specs/017-expand-agent-canvas-ux/` | Feature spec, plan, tasks, contracts |

## Spec 017 task status

The tasks.md in `specs/017-expand-agent-canvas-ux/tasks.md` is the authoritative task list. Most foundational tasks (pan/zoom, goal creation, room canvas, layout persistence) are done. Outstanding areas:

- **Room card expanded state**: currently shows work items; should embed a mini-chat interface with actual thread messages
- **Streaming chat bubbles**: thinking updates, tool-call/result bubbles inside room chat (FR-001–008)
- **SSE agent-join listener**: when Prime assigns an agent, card appears on canvas in real time (FR-024)
- **Room card last-message preview**: currently shows work item count, not actual last thread message; needs `fetchThreadMessages` per room or a `last_message` field on the threads API
- **Bottom toolbar in rooms view**: toolbar is on canvas but not yet on the rooms/chat sidebar view (FR-014)
- **Approval cards inline**: approval requests need a card inside the room chat (FR-006)
- **Canvas tests**: `backend/tests/prime-agent-config.test.ts` and canvas route tests

## OpenSwarm reference

[openswarm-ai/openswarm](https://github.com/openswarm-ai/openswarm) — the inspiration. Their AgentCard is the design reference:
- 480px min width, header + metadata row, streaming chat via WebSocket, inline approval UI
- `frontend/src/app/pages/Dashboard/cards/AgentCard.tsx` is the key file
- Status colors: green=running, orange=waiting approval, gray=done/stopped, red=error

## Known issues / next steps

1. **Clear test rooms**: delete stale threads from the dev DB. Run:
   ```sql
   DELETE FROM threads WHERE metadata->>'kind' != 'welcome';
   ```
   The welcome room is protected by the seed condition.

2. **Room card needs actual last message**: add `last_message_content` / `last_message_at` to the threads list API, or add a separate `/api/threads/:id/messages?limit=1` fetch per card.

3. **Expanded room card**: hook up to `fetchThreadMessages` to show actual chat history inside the expanded card.

4. **Bottom toolbar on CollaborationRoomsView**: import `BottomActionToolbar` into the rooms view (currently only on CircuitView).

5. **Spring animation on new rooms**: add CSS animation on `RoomCard` mount (currently static).

6. **Canvas navigate button**: currently navigates to `/` — needs to navigate to the specific room URL.

## Environment

- Start everything: `./scripts/dev-up.sh` from repo root
- Backend: `tsx watch src/index.ts` on port 3100
- Frontend: `vite` on port 5173
- Dev DB: Unraid-hosted Postgres at `PRIMELOOP_DEV_DATABASE_HOST` (defaults to `192.168.20.14:55433`)
- The Docker `backend-dev` container uses `local/primeloop-backend:current` image — needs a rebuild to pick up changes when not using `dev-up.sh`

## Current branch

`main` — all recent work was merged. Next feature work should be on a new branch.
