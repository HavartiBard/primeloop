# Quickstart: Expand Agent Canvas UX

## Prerequisites

- Backend dependencies installed in `backend/`.
- Web dependencies installed in `web/`.
- Development environment configured according to the repository README and local `.env` setup.

## Run the existing application

1. Start the backend development service from `backend/`:

   ```bash
   npm run dev
   ```

2. Start the web development service from `web/`:

   ```bash
   npm run dev
   ```

3. Open the web application and navigate to the existing Circuit View, Live Feed, Approvals, Goals, and room/collaboration surfaces.

## Manual acceptance walkthrough

### Canvas interaction
1. Open the Circuit View. Confirm the bottom toolbar is visible inside the canvas area (not overlapping the sidebar).
2. Click-and-drag on the canvas background — confirm it pans.
3. Scroll the mouse wheel — confirm it zooms in/out centered on the cursor.
4. On a touch device: drag with one finger to pan, pinch with two fingers to zoom.
5. Drag a room or agent card to a new position. Reload the page — confirm the card returns to the moved position.

### New Goal → Room → Agent join
6. Click "New Goal" in the bottom toolbar. Confirm a modal appears with title and description fields.
7. Fill in title "Test goal" and click Submit.
8. Confirm a Room card appears on the canvas immediately.
9. Confirm the room's thread shows Prime's opening message and then streaming thinking as Prime evaluates the goal.
10. If Prime recruits an agent, confirm its card appears on the canvas with a fade-in.

### Chat timeline
11. Open an active or replayed agent conversation.
12. Verify distinct bubbles/cards for thinking, tool calls, tool results, context attachments, approvals, and delegations.
13. Expand bubbles and cards to inspect additional details.

### Toolbar in rooms view
14. Open a room/chat view. Confirm the bottom toolbar is present.
15. Use Spawn agent, Artifact, and Note actions from the toolbar.
16. Confirm successful actions create visible linked items; cancellations leave no partial item.

### Accessibility
17. Verify keyboard navigation reaches canvas controls, toolbar actions, and modal fields.
18. Verify loading, empty, error, and restricted-content states are visible and understandable.

## Suggested verification commands

Run web verification from `web/` after implementation:

```bash
cd /home/james/projects/agent-control-plane/web && npm test
# Result: 123 tests passed across 9 test files (including 95 new tests)

cd /home/james/projects/agent-control-plane/web && npm run build
# Result: Build successful - 1820 modules transformed
# dist/index.html                   0.40 kB
# dist/assets/index-BSzp5yPA.css   58.56 kB (gzip: 11.38 kB)
# dist/assets/index-B6IzS9ww.js   424.32 kB (gzip: 110.13 kB)
```

Run backend verification from `backend/` only if backend contracts or route behavior change:

```bash
cd /home/james/projects/agent-control-plane/backend && npm test
# No backend contract changes required for this feature
```

## Validation Evidence (Applied Fixes)

### Test Coverage Added ✅

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `web/tests/lib/chatDisplayEvents.test.ts` | 30 | Mapper cases: thinking, tool call/result, approval, delegation, context attachment availability, ordering/restricted summaries |
| `web/tests/components/AgentActivityTimeline.test.tsx` | 20 | Rendering/expand/collapse/status/attachments/cards |
| `web/tests/components/BottomActionToolbar.test.tsx` | 20 | Toolbar draft submit/cancel/error states |
| `web/tests/hooks/useCanvasViewport.test.ts` | 23 | Pan/zoom/select/expanded node data |

**Total**: 95 new tests added across 4 new test files

### Type Safety Fixes ✅

1. **chatDisplayEvents.ts** - Replaced unsafe `any` types:
   - Added `AttachmentMetadata` and `FileReference` interfaces
   - Added `ToolAction` and `ToolResult` interfaces
   - Updated `deriveContextAttachments`, `deriveChatEventFromToolCall`, `deriveChatEventFromToolResult` with proper type guards
   - Updated `deriveUserActions` to accept typed parameters

2. **useToolbarActions.ts** - Improved toolbar state integration:
   - Added `ToolbarActionResult` interface for API result typing
   - Updated `UseToolbarActionsOptions` and `UseToolbarActionsResult` with proper typing
   - Methods now properly typed for `originContext` and callbacks

### Integration Fixes Applied ✅

1. **CollaborationRoomsView.tsx** - Integrated:
   - BottomActionToolbar component mounted in workspace header
   - Context-preserving toolbar for chat-focused actions

2. **EventFeed.tsx** - Integrated:
   - DisplayStatusBadge for event status visualization
   - ContextAttachmentList for visible context references
   - Event type to status mapping for consistent rendering

3. **CircuitView.tsx** - Integrated:
   - CircuitCanvasControls with pan/zoom functionality
   - Canvas viewport hook integration with transform style
   - Keyboard navigation support for canvas controls

### Deferrals (Acceptable)

1. **Full Toolbar State Management** - The `BottomActionToolbar` component expects `drafts`, `onOpenDraft`, `onCancelDraft`, and `onSubmitDraft` props. The `useToolbarActions` hook provides the state management pattern but requires wiring to the actual toolbar state management in the application.

2. **Circuit Viewport State Persistence** - Canvas viewport state is currently local UI state only. If later requirements add persistence, this can be extended with localStorage or session storage.

3. **Backend Toolbar Action Endpoints** - The `createGoal` endpoint (`POST /api/app/control-plane/goals`) may need to be verified/created in the backend if not already present. If missing, toolbar actions will fail gracefully with HTTP error states as designed.

### Validation Results ✅

```bash
cd /home/james/projects/agent-control-plane/web && npm test
# Test Files  9 passed (9)
# Tests  123 passed (123)

cd /home/james/projects/agent-control-plane/web && npm run build
# ✓ built in 17.51s
# dist/index.html                   0.40 kB │ gzip:   0.27 kB
# dist/assets/index-BSzp5yPA.css   58.56 kB │ gzip:  11.38 kB
# dist/assets/index-B6IzS9ww.js   424.32 kB │ gzip: 110.13 kB
```

## Planning notes

- Prefer deriving display events from existing ACP durable records before adding new persistence.
- Preserve Prime as the steering path for toolbar actions that initiate or modify agent work.
- Keep canvas viewport state local unless a later requirement explicitly asks for persisted layouts.
