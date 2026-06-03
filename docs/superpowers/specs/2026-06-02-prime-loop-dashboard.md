# Prime Loop Dashboard

**Date:** 2026-06-02  
**Status:** Approved for implementation

## Summary

Add a Loop Activity page to the PrimeLoop dashboard so you can evaluate the prime agent's work loop after the fact — seeing when ticks ran, when they were skipped (quiescent), what they cost in tokens, and what happened on each active tick.

## Sidebar restructure

The sidebar widens from 96px to 192px and switches from stacked icon-only buttons to horizontal icon + label rows. This is a global change affecting all existing nav items.

**Existing nav items** (Circuit, Rooms, Goals, Approvals, Learning, Schedule, Settings) keep their current routes but get the new horizontal layout.

A **Prime Agent** collapsible group is added, separated from the flat items by a divider. It is expanded by default. Sub-items are indented. The group header is a clickable row that toggles expand/collapse, stored in `localStorage` so it persists across reloads.

Prime Agent sub-pages:
- **Loop** — the new page built in this spec
- **Sessions** — future (routes to existing prime sessions list, currently no dedicated page)
- **Modules** — future
- **Config** — future

Sessions/Modules/Config render as disabled/placeholder items for now; they do not need to route anywhere until those pages are built.

## Loop page

### Route

`/prime/loop` — registered in `App.tsx` alongside existing routes.

### Layout

```
┌─ stat row (4 tiles) ─────────────────────────────────────────┐
│  Total ticks │ Skipped (%) │ Tokens used │ Actions taken      │
└──────────────────────────────────────────────────────────────┘
┌─ time range pills ───────────────────────────────────────────┐
│  [1h]  [6h]  [24h ●]  [7d]                  □ Active only    │
└──────────────────────────────────────────────────────────────┘
┌─ activity bar chart ─────────────────────────────────────────┐
│  One bar per 30-min bucket. Height = token count.            │
│  Colour: accent = active, muted = quiescent, amber = failed  │
│  x-axis labels: start / midpoint / now                       │
└──────────────────────────────────────────────────────────────┘
┌─ tick list ──────────────────────────────────────────────────┐
│  Scrollable. Each row: status dot · relative time · status   │
│  label · token count (active only) · action count            │
│  Click row → expands inline to show reasoning + actions +    │
│  work items snapshot                                         │
└──────────────────────────────────────────────────────────────┘
```

### Stat tiles

Computed from the filtered session list (respects current time range):

| Tile | Value |
|------|-------|
| Total ticks | Count of all `cron_fast` sessions |
| Skipped | Count where `reasoning_summary` starts with `"Skipped:"`, shown as `N (X%)` |
| Tokens used | Sum of `token_count` across all sessions |
| Actions taken | Sum of `actions_taken.length` across active sessions |

### Time range

Pill buttons: **1h / 6h / 24h / 7d**. Default: 24h. Selection stored in `localStorage` key `prime-loop-time-range`. An "Active only" checkbox hides quiescent rows from the tick list (bar chart always shows all buckets).

### Bar chart

- X axis: time buckets (30-min width)
- Y axis: total tokens in that bucket (sum across all sessions that started in the bucket)
- Colours: accent purple = active sessions present, amber = failed sessions present, muted border = all-quiescent bucket
- No external charting library — rendered as a flex row of `<div>` bars (same pattern as the mockup). Tooltip on hover shows bucket time + tick count + token sum.
- Clicking a bar scrolls the tick list to the first session in that bucket.

### Tick list

Each row:
- Status dot (purple = completed/active, muted = quiescent skip, amber = failed)
- Relative timestamp (`2 min ago`, `3h ago`, etc.)
- Status label: **Active**, **Skipped**, or **Failed**
- Token count (right-aligned, shown only for active/failed rows)
- Action count badge (shown only when > 0)

Quiescent rows show a dimmer style to reduce visual noise. Clicking any row expands an inline detail drawer (not a separate panel — accordion style):

**Expanded row detail:**
- ISO timestamp + trigger type
- Token count + model used (if present)
- Reasoning summary (full text)
- Actions taken: list of `{ type, reason }` objects
- Work items at time of tick: not available from the sessions API directly — omit for now, show a note "work item snapshot not yet available"

### Data fetching

Uses the existing `/api/prime-agent/sessions` endpoint with `limit` parameter. Client filters by `trigger_type === 'cron_fast'` and by `started_at` within the selected time window.

No new backend endpoint needed for the initial version. The sessions endpoint already returns all required fields: `id`, `trigger_type`, `status`, `started_at`, `completed_at`, `reasoning_summary`, `actions_taken`, `token_count`.

Poll interval: 30s (same as other runtime data on the Operations Portal).

## Files changed

| File | Change |
|------|--------|
| `web/src/components/Sidebar.tsx` | Rewrite — 192px width, horizontal layout, collapsible Prime group |
| `web/src/App.tsx` | Add `/prime/loop` route, pass Prime group collapse state to Sidebar |
| `web/src/pages/prime/LoopPage.tsx` | New — full Loop page component |
| `web/src/api.ts` | Add `fetchPrimeLoopSessions(limit)` (thin wrapper over existing sessions endpoint) |

## Out of scope

- Work item snapshot per tick (requires a new backend query joining sessions to work_item state at a point in time)
- Sessions / Modules / Config sub-pages (future)
- Exporting loop data
- Alerts or thresholds on token spend
