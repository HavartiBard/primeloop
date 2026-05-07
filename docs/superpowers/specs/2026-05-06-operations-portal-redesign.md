# Operations Portal UI Redesign — Design Spec
**Date:** 2026-05-06  
**Scope:** Two new views for the agent-control-plane Operations Portal

---

## Overview

Replace the current collaboration-rooms panel with a fully redesigned Operations Portal featuring a compact terminal/dashboard aesthetic and a new Circuit View (PCB dependency-graph canvas). Both views share a single design system (CSS custom properties, light/dark theme).

---

## Part 1 — Design System

### CSS Custom Properties

All design tokens live in `web/src/index.css` under `:root` (light) and `[data-theme="dark"]`. Existing partial tokens are extended to cover the full palette:

| Token group | Vars |
|---|---|
| App shell | `--app`, `--panel`, `--panel-sub` |
| Borders | `--border`, `--border-md` |
| Typography | `--tx`, `--tx-muted`, `--tx-meta` |
| Grid lines | `--grid-maj`, `--grid-min` |
| Selection | `--sel-bg`, `--sel-bd` |
| State — ok/active | `--c-ok-tx/bg/bd/glow` |
| State — running/cyan | `--c-run-tx/bg/bd/glow` |
| State — blocked/red | `--c-blk-tx/bg/bd/glow` |
| State — approval/amber | `--c-att-tx/bg/bd/glow` |
| State — neutral/gray | `--c-neu-tx/bg/bd/glow` |
| State — system/purple | `--c-sys-tx/bg/bd/glow` |

**Light theme base:** off-white app shell (`#eef0f4`), white panels, thin `rgba(0,0,0,0.10)` borders.  
**Dark theme base:** near-black app shell (`#0e1015`), deep-charcoal panels (`#171a1f`), `rgba(255,255,255,0.07)` borders.

### Typography

- Body/labels: `Inter`, `Segoe UI`, system-ui — 11–13px
- Metadata, timestamps, chips, commands: monospace — 9–11px
- Headings: modest, not hero-sized (14–16px max)
- Radius: 4–6px panels/cards, pill (99px) for chips

### State Colors

| State | Color |
|---|---|
| Active / success | Green (`#22c55e` / `#4ade80` dark) |
| Running / processing | Cyan (`#0891b2` / `#22d3ee` dark) |
| Blocked / error | Red (`#ef4444`) |
| Approval / attention | Amber (`#d97706` / `#fbbf24` dark) |
| Neutral / closed | Gray |
| System | Purple (`#7c3aed` / `#a78bfa` dark) |

---

## Part 2 — Rooms View (CollaborationRoomsView)

### Layout

Three-column layout within the main content area (left of the sidebar):

```
┌─────────────────────────────────────────────────┐
│ Top Strip: status chips + view-tabs + theme btn  │
├──────────────┬──────────────────────────────────┤
│ Room List    │ Chat / Detail Panel               │
│ (300px)      │                                   │
│              ├──────────────────────────────────┤
│ Filter tabs  │ Terminal Pane (collapsible)        │
│ Search       │ (shows agent command activity)    │
└──────────────┴──────────────────────────────────┘
```

### Room List Panel (left, ~300px)

- **Filter tabs:** Active | All | Archived (default: Active)
- **Search input:** text filter against room name, monospace placeholder `search rooms...`
- **Room rows:** compact single-line cards
  - State indicator dot (colored per state)
  - Room name (12–13px, semi-bold)
  - Status chip (tiny pill, uppercase monospace): ACTIVE / BLOCKED / RUNNING / CLOSED
  - Last-updated timestamp (monospace, muted, right-aligned)
  - Hover: faint blue-tinted background
  - Selected: `--sel-bg` background + `--sel-bd` left border accent

### Chat / Detail Panel (right)

When a room is selected:
- Header: room name, status chip, participant avatar chips (tiny pills with state dots)
- Message thread: derived from room activity / signals
- Signals section: flat data grid (label + value pairs)
- Artifacts section: typed rows — work items (`▪`) and delegations (`◦`)
- **Chat input** at bottom: text field + send button, monospace placeholder `$ message...`

### Collapsible Terminal Pane

- Lives below the chat panel, initially collapsed (shows handle bar)
- Expand: ~180px tall scrollable terminal
- Shows agent command activity feed: `$ Working... (2m 14s)` style entries
- Toggle via click on the handle or a chevron icon

---

## Part 3 — Circuit View (New Component)

### Route / Entry

New page `web/src/pages/CircuitView.tsx`, wired into the app router/navigation alongside OperationsPortal. Accessible from the sidebar nav and via the "Circuit" view tab in the top strip.

### Canvas

- Infinite-scroll canvas with a 16px minor grid / 80px major grid (CSS background-image lines)
- Nodes: positioned absolute, all `left`/`top` are multiples of 16px
- Standard node width: 176px (11 × 16)
- Room node width: 192px (12 × 16)
- Canvas size: sufficient to hold the full graph; scrollable within the viewport

### Node Types

Six node types, each with a distinct monospace type label color:

| Type | Label color | Notes |
|---|---|---|
| Agent | Cyan `#0891b2` | name, role, work counts, thread/infra chip |
| Room | Purple `#7c3aed` | title, summary, status — blocked state overrides all others |
| Work | Green `#15803d` | task title, owner chip, state |
| Approval | Amber `#d97706` | title, gating description, "pending" pill — styled as a blocker |
| Tool | Gray `#6b7280` | tool name, usage status |
| System | Purple `#7c3aed` | system name, health status |

### Node Anatomy

Each node card:
```
┌─[TYPE label]──────────[state dot]─┐
│ Title (12px semi-bold)            │
│ Summary (10px monospace muted)    │
│ [meta chip] [meta chip] [status◉] │
└───────────────────────────────────┘
```

**State borders + glow rings:**
- Active: green border + soft green glow ring
- Running: cyan border + soft cyan glow ring  
- Blocked: red border + stronger red glow ring (4px spread)
- Approval: amber border (left border 3px) + amber glow ring (4px spread)
- Neutral: gray border, 0.72 opacity
- System: purple border + soft purple glow

**State dots:** animated pulse for running/blocked/approval states.

### Edge Types

Seven edge kinds rendered as orthogonal (Manhattan) SVG paths:

| Edge | Color | Style | Animation |
|---|---|---|---|
| coordinates | Blue `#3b82f6` | solid 1.5px | marching dashes (0.65s) |
| participating | Gray `#6b7280` | solid 1.2px | marching dashes (0.65s) |
| owns active work | Green `#22c55e` | solid 1.2px | marching dashes (1.1s slow) |
| assigned | Cyan `#0891b2` | dashed 1px | marching dashes (0.65s) |
| approval gate | Amber `#d97706` | solid 2px | opacity throb (1.0s) |
| blocked on | Red `#ef4444` | solid 2px | opacity throb (1.5s) |
| uses / depends | Gray `#9ca3af` | dotted 1px | none (static) |

Arrow markers per edge type. Orthogonal path routing: `M x1,y1 V midY H x2 V y2`.

**Animation keyframes:**
```css
@keyframes march { to { stroke-dashoffset: -28; } }
@keyframes throb { 0%,100%{opacity:1} 50%{opacity:0.28} }
```

### Edge Legend

Fixed to the viewport bottom-right (`position: fixed; bottom: 16px; right: 16px`), always visible regardless of canvas scroll. Contains a small SVG line sample + label for each edge type.

### Display Priority

- Show only currently relevant / open runtime evidence
- De-emphasize (opacity 0.72, dimmed border) stale/completed nodes
- Rooms with blocked state visually stand out more than running rooms
- Approval nodes styled as blockers (amber glow + border-left accent), not normal tasks

### Interactions

- Click room node → navigate to room detail (CollaborationRoomsView with that room selected)
- Hover node → slight lift (`translateY(-2px)`)
- Pan: native canvas scroll

---

## Part 4 — Navigation / Shell

### Top Strip (shared across views)

- Status summary chips: `N active`, `N blocked`, `N approval pending`, `N rooms · N agents`, `streaming`
- View tabs toggle: `Rooms` | `Circuit` (inline, not floating)
- Theme toggle button: inline in top strip (right of view tabs), not `position: fixed`

### Sidebar

Existing 68px icon sidebar is retained. Circuit view gets a new active nav item.

---

## Implementation Files

| File | Action |
|---|---|
| `web/src/index.css` | Add/extend full design token set |
| `web/src/components/CollaborationRoomsView.tsx` | Redesign: filter tabs, search, compact rows, chat input, terminal pane |
| `web/src/pages/CircuitView.tsx` | New: canvas + SVG edges + node components |
| `web/src/pages/OperationsPortal.tsx` | Add view-tab toggle, wire CircuitView |
| `web/src/App.tsx` | Add CircuitView route if needed |

---

## Out of Scope

- Backend API changes (views consume existing WebSocket / REST data)
- Real-time data binding for circuit nodes (static mock data is acceptable for MVP canvas)
- Drag-and-drop node repositioning
- Canvas zoom controls
