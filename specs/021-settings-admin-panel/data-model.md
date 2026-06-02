# Data Model: Settings & Admin Panel

**Date**: 2026-06-01 | **Phase**: 1

This feature introduces no new backend entities. All data is read from and written to existing API endpoints. This document captures the frontend state shape and how existing API types map to each Settings tab.

---

## Settings Shell State

```typescript
// Settings.tsx local state
type SettingsTabId = 'providers' | 'routing' | 'agents' | 'integrations' | 'personality'

interface SettingsProps {
  defaultTab?: SettingsTabId   // pre-selects a tab when navigating from a legacy route
}

// Component local state
const [activeTab, setActiveTab] = useState<SettingsTabId>(defaultTab ?? 'providers')
```

No shared state flows between tabs. Each tab manages its own data lifecycle via hooks or internal state.

---

## Routing Tab State

**Source API**: `GET /setup/draft` → `SetupDraft.function_assignments`
**Save API**: `PATCH /setup/draft` with `{ function_assignments }`

```typescript
// RoutingTab.tsx local state
interface RoutingTabState {
  assignments: FunctionAssignment[]   // loaded from setup draft
  providers: Provider[]               // loaded from useProviders hook
  saving: boolean
  saveError: string | null
  saveSuccess: boolean
}
```

The `FunctionAssignment` type (from `types.ts`):

| Field | Type | Description |
|---|---|---|
| `function_key` | string | Prime function identifier (e.g., `planning`, `routing`) |
| `display_name` | string | Human-readable function name |
| `provider_id` | string \| null | Selected provider |
| `model` | string \| null | Selected model |
| `validation_status` | `'missing' \| 'valid' \| 'warning' \| 'blocked'` | Computed readiness |

---

## Personality Tab State

**Source API**: `GET /prime-agent/profile` → `PrimeProfileResponse`
**Save API**: `PUT /prime-agent/profile` with soul + operating sections

```typescript
// PersonalityTab.tsx local state
interface PersonalityTabState {
  profile: ProfileDraft | null    // loaded from API; null while loading
  saving: boolean
  saveError: string | null
  saveSuccess: boolean
}
```

The `ProfileDraft` type is already defined in `Setup.tsx` (exported). `PersonalityTab.tsx` imports and uses it directly.

Mapping from API response to `ProfileDraft`:

| API field | ProfileDraft field |
|---|---|
| `soul.identity` | `profile.soul.identity` |
| `soul.voice_tone` | `profile.soul.voice_tone` |
| `soul.decision_style` | `profile.soul.decision_style` |
| `operating.default_behaviors` | `profile.operating.default_behaviors` |
| `operating.approval_thresholds` | `profile.operating.approval_thresholds` |

---

## Embedded Tabs (no new state)

| Tab | Component | Data source |
|---|---|---|
| Providers | `<Providers />` | `useProviders()` hook — unchanged |
| Agents | `<Agents />` | `useAgentRegistry()` + `useProviders()` + `useMcpServers()` — unchanged |
| Integrations | `<McpServers />` | `useMcpServers()` hook — unchanged |

---

## Navigation State Changes (App.tsx)

```typescript
// Removed from NAV array:
// { label: 'Agents',    href: '/agents' }
// { label: 'MCP',       href: '/mcp-servers' }
// { label: 'Providers', href: '/providers' }

// Added to NAV array:
// { label: 'Settings',  icon: <Settings />, href: '/settings' }

// Extended page switch:
// '/settings'     → <SettingsPage />
// '/providers'    → <SettingsPage defaultTab="providers" />
// '/mcp-servers'  → <SettingsPage defaultTab="integrations" />
// '/agents'       → <SettingsPage defaultTab="agents" />
```

No new state fields on the `Layout` component. The `defaultTab` prop is passed inline at the page switch level.
