# Handoff

## Recent Progress

- Native memory, loop detection, snapshots, and fleet learning views are implemented and deployed.
- Added an HTTP control-plane bridge for external agents with bearer-token issuance and tool calls.
- Reworked the `Agents` page so the registry is the selector, health is shown in-table, and edit flows open inline in the lower detail panel.
- CP tokens are now masked by default with an explicit `Show` toggle in the bridge panel.
- Live review stack is currently running on the `agent-cp-*` deployment path with `pgvector/pgvector:pg16` and `SECRET_ENCRYPTION_KEY` configured.
- Prime setup now restarts the Prime service after a successful wizard launch, so a fresh instance can handle the first message without a manual backend restart.
- Prime chat replies now come from a dedicated user-facing `response` field instead of reusing the internal `reasoning` summary.
- Prime messages now go through the shared queue, duplicate `prime.message` sessions are reconciled by `message_id`, and Prime runtime status is written back to `prime_agent_config`.
- The local dev wrapper is the expected startup path; use `./scripts/dev-up.sh` and set `ACP_VM_IP=127.0.0.1` explicitly if hostname detection is unavailable in the current shell.

## Current direction

The original "circuit canvas" concept has been abandoned.

The Operations Portal is now a room-centric collaboration view:

- left drawer: collaboration rooms sorted by activity
- room status indicators:
  - green = active
  - blue pulsing = attention/activity
  - red pulsing = blocked
  - gray = archived
- right workspace: selected room with:
  - `Chat`
  - `Status`
  - `Signals`
  - `Artifacts`

This is the current product direction and should be continued instead of reviving the old canvas/map concept.

## Key files

- `web/src/components/LiveCircuitMap.tsx`
  - despite the filename, this is now the room-centric workspace UI
  - contains:
    - room drawer
    - selected room workspace
    - fallback sample rooms/messages for sparse live data
- `web/src/pages/OperationsPortal.tsx`
  - top status strip remains
  - page is a flex column
  - main content section gives remaining viewport height to the room workspace
- `web/src/index.css`
  - light/dark theme variables
  - room/chat terminal colors are theme-aware
  - tone colors moved to CSS variables to avoid poor light-mode pastel rendering

## What was completed

- removed the multi-agent circuit/canvas layout
- replaced it with a room drawer + room workspace
- made the portal layout consume remaining viewport height
- added internal scrolling so drawers and room content stop clipping
- removed hardcoded dark-only chat styling in light mode
- kept fallback sample data so the UI is visible even when runtime data is sparse

## Current behavior

- rooms are sorted by derived activity score
- room state is derived roughly from:
  - blocked work -> `blocked`
  - queued/running delegations -> `attention`
  - active work -> `active`
  - closed/no activity -> `archived`
- right pane shows:
  - chat transcript
  - status summary
  - signals derived from room/runtime state
  - artifacts derived from work items and delegations

## Known limitations / likely next steps

1. Rename `LiveCircuitMap.tsx` to something accurate like `CollaborationRoomsView.tsx`.
2. Make the room drawer denser so more rooms fit at once.
3. Tighten the right-side room header so more vertical space goes to chat and artifacts.
4. Improve the visual hierarchy of `Status`, `Signals`, and `Artifacts`.
5. Replace some fallback/sample content with richer live-derived room content where available.
6. Review whether the room list should include agent avatars/names more explicitly.

## Verification

Latest successful verification:

- `cd web && npm run build`

Build passed after the room-centric rewrite.

## Preview

At the time of handoff, preview server was expected at:

- `http://localhost:5173/`
- `http://<vm-ip>:5173/`
- backend API at `http://<vm-ip>:3100/`

Use `./scripts/dev-up.sh` from the repo root instead of starting `web/` manually. The script clears stale listeners on `3100` and `5173`, starts both services together, binds Vite on the VM interface, and points the backend at the Unraid dev database by default.

## Environment notes

- sandboxing is working again in this environment
- this latest room-centric rewrite is local work in `agent-control-plane`
- no live deploy was done as part of this UI iteration
- local backend dev requires `DATABASE_URL` plus `SECRET_ENCRYPTION_KEY`; the wrapper script now supplies defaults for the Unraid-backed dev setup
- development assumes the shared hosted dev DB, not a local long-lived Postgres instance
- the Docker-backed `test:db` flow is only an optional disposable backend test database via `TEST_DATABASE_URL`
- when Prime looks stuck, check `prime_agent_sessions` first; duplicate sessions for the same message can indicate a stale run that should be marked failed instead of waiting indefinitely
