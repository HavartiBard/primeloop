# UI Contracts: Settings & Admin Panel

**Date**: 2026-06-01 | **Phase**: 1

This feature is frontend-only. The UI contracts below define component interfaces and navigation contracts. No new backend API endpoints are introduced.

---

## Settings Page Component Contract

```typescript
// web/src/pages/Settings.tsx

type SettingsTabId = 'providers' | 'routing' | 'agents' | 'integrations' | 'personality'

interface SettingsProps {
  defaultTab?: SettingsTabId  // optional; defaults to 'providers'
}

export function Settings({ defaultTab = 'providers' }: SettingsProps): JSX.Element
```

**Behavior**:
- Renders a tab bar with 5 tabs in order: Providers, Routing, Agents, Integrations, Personality
- Active tab content is mounted; inactive tabs are unmounted (no keep-alive)
- Tab switching is instant (no async required; each tab manages its own data)
- `defaultTab` is applied only on initial mount; subsequent tab switches are user-driven

---

## RoutingTab Component Contract

```typescript
// web/src/pages/settings/RoutingTab.tsx

// No external props; manages its own data lifecycle
export function RoutingTab(): JSX.Element
```

**Behavior**:
- On mount: calls `fetchSetupDraft()` to load `function_assignments` and uses `useProviders()` for provider list
- Renders `StepPrimeFunctionAssignments` (from `Setup.tsx`) with loaded state
- "Save" button calls `saveSetupDraft({ function_assignments })` and shows inline success/error feedback
- Loading state: skeleton or spinner while draft is fetching
- Error state: inline error message if draft load fails; retry button

---

## PersonalityTab Component Contract

```typescript
// web/src/pages/settings/PersonalityTab.tsx

// No external props; manages its own data lifecycle
export function PersonalityTab(): JSX.Element
```

**Behavior**:
- On mount: calls `fetchPrimeProfile()` and maps response to `ProfileDraft`
- Renders `StepPersonality` (from `Setup.tsx`) with loaded profile state
- "Save" button calls `updatePrimeProfile({ soul, operating })` and shows inline success/error feedback
- Loading state: spinner while profile is fetching
- Error state: inline error if profile load fails; retry button

---

## Navigation Contract (App.tsx changes)

### Sidebar NAV array — after

| Label | Icon | href |
|---|---|---|
| Circuit | CircuitBoard | `/circuit` |
| Rooms | MessageSquare | `/` |
| Goals | Bot | `/goals` |
| Approvals | Server | `/approvals` |
| Learning | CalendarClock | `/learning` |
| Schedule | CalendarClock | `/schedule` |
| Settings | Settings (lucide) | `/settings` |

Items removed: `Agents (/agents)`, `MCP (/mcp-servers)`, `Providers (/providers)`

### Page switch — after (additions only)

```
'/settings'    → <Settings />
'/providers'   → <Settings defaultTab="providers" />
'/mcp-servers' → <Settings defaultTab="integrations" />
'/agents'      → <Settings defaultTab="agents" />
```

The existing catch-all (`else → <Providers />`) MUST be replaced with a sensible default (e.g., `<OperationsPortal />` or the Settings page).

---

## Tab Content Contract

Each tab pane receives no props from the Settings shell. Tab content components are self-contained.

| Tab ID | Component rendered | Notes |
|---|---|---|
| `providers` | `<Providers />` | Existing page, unchanged |
| `routing` | `<RoutingTab />` | New adapter; wraps `StepPrimeFunctionAssignments` |
| `agents` | `<Agents />` | Existing page, unchanged |
| `integrations` | `<McpServers />` | Existing page, unchanged |
| `personality` | `<PersonalityTab />` | New adapter; wraps `StepPersonality` |

---

## Visual Contract

- Tab bar: horizontal button group at the top of the settings content area, same button toggle pattern as `StepPersonality` sections/markdown toggle
- Active tab button: `border-[#6ee7ff] bg-[#1f6feb] text-white`
- Inactive tab button: `border-[var(--border-soft)] bg-[var(--panel-subtle)] text-[var(--muted)] hover:bg-[var(--panel)]`
- Content area: scrollable, padded, consistent with other full-page views
- Page header: shows "Settings" as the page label in the topbar breadcrumb (same mechanism as other pages via `pageLabel` derived from nav item label)
