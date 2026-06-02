# Research: Settings & Admin Panel

**Date**: 2026-06-01 | **Phase**: 0

## Finding 1: Navigation system — no react-router

**Decision**: Handle "redirects" for removed routes by extending the App.tsx page switch, not URL-based routing.

**Rationale**: The app uses a `useState<string>` page variable in `App.tsx` with a manual switch on page path. There is no `react-router` in the dependency tree. "Redirects" for removed routes (e.g., `/providers`, `/mcp-servers`) are handled by mapping those path strings to the Settings page with a pre-selected tab, passed as a prop or via a URL-like query convention.

**Alternatives considered**: Installing react-router to enable true URL-based routing. Rejected — it is a significant dependency addition with no benefit beyond this feature, contradicts YAGNI, and would require broad refactoring of the existing page switch.

---

## Finding 2: Existing pages are fully self-contained — embed verbatim

**Decision**: `<Providers />`, `<Agents />`, and `<McpServers />` are rendered directly as tab content inside `Settings.tsx` with no prop changes.

**Rationale**: Each page component uses its own hooks (`useProviders`, `useAgentRegistry`, `useMcpServers`) and manages its own modal/form state internally. None require parent-supplied state. They can be mounted inside a tab pane without any adapter layer.

**Alternatives considered**: Extracting the CRUD logic from each page into a shared hook and rebuilding the UI inside Settings. Rejected — duplicates working code for no gain; the existing pages already satisfy the functional requirement.

---

## Finding 3: Routing/function assignments live in the setup draft

**Decision**: The Routing tab uses `fetchSetupDraft()` to load current `function_assignments` and `saveSetupDraft({ function_assignments })` to persist changes.

**Rationale**: Post-onboarding routing assignments are stored as `function_assignments` in the `/setup/draft` endpoint (types: `FunctionAssignment[]`). There is no separate `/routing` endpoint. The setup draft is the live source of truth for model routing — it is not just a wizard buffer.

The `StepPrimeFunctionAssignments` component from `Setup.tsx` already handles the provider/model assignment UI. `RoutingTab.tsx` will load the draft on mount, pass `functionAssignments` and `providers` to that component, and call `saveSetupDraft` on save.

**Alternatives considered**: Building a new backend `/settings/routing` endpoint. Rejected — the existing draft endpoint already serves this purpose and adding a parallel endpoint creates data-model divergence.

---

## Finding 4: Prime personality has dedicated live API endpoints

**Decision**: The Personality tab uses `fetchPrimeProfile()` to load and `updatePrimeProfile()` to save, bypassing the setup draft entirely.

**Rationale**: Unlike routing, Prime's personality (soul + operating sections) has dedicated endpoints: `GET /prime-agent/profile`, `PUT /prime-agent/profile`, `PATCH /prime-agent/profile/sections/:key`. These are already used by the wizard's final launch step and are appropriate for post-launch editing too.

The existing `StepPersonality` component from `Setup.tsx` is prop-driven (`profile: ProfileDraft`, `onChange`) and can be used inside `PersonalityTab.tsx` with a thin wrapper that loads from the profile API and saves on explicit submit.

**Alternatives considered**: Having the Personality tab write through the setup draft. Rejected — the profile API is the canonical post-launch interface for Prime's personality; using the draft would be semantically incorrect and could conflict with wizard state.

---

## Finding 5: The topbar "Settings" button currently goes to Governance

**Decision**: Leave the topbar Settings button pointing to `/governance`. The new Settings sidebar item navigates to `/settings`.

**Rationale**: The topbar button currently does `setPage('/governance')` with a Settings icon (line 118-123 of `App.tsx`). Changing it would be a non-trivial UX shift outside this feature's scope. The spec explicitly notes governance stays in the topbar for this iteration.

**Alternatives considered**: Repurposing the topbar button to open the new Settings panel. Deferred — this is a UX decision that should be deliberate, not a side effect of this feature.

---

## Finding 6: Tab pre-selection for legacy routes

**Decision**: Map the old routes to Settings with a `defaultTab` prop: `/providers` → `Settings defaultTab="providers"`, `/mcp-servers` → `Settings defaultTab="integrations"`, `/agents` → `Settings defaultTab="agents"`.

**Rationale**: Since the sidebar items for Providers, MCP, and Agents will be removed, any code that calls `setPage('/providers')` (e.g., the Governance page or any deeplink) would drop to the catch-all. The App.tsx page switch will be extended to handle these legacy paths by rendering `<Settings defaultTab={...} />` — a one-liner per removed route.

**Alternatives considered**: Keeping the old routes as aliases that render the standalone pages. Rejected — defeats the purpose of the consolidation and creates two entry points for the same content.

---

## Finding 7: Sidebar item count

**Current sidebar**: Circuit, Rooms, Goals, Approvals, Learning, Schedule, Agents, MCP, Providers = **9 items**

**After redesign**: Circuit, Rooms, Goals, Approvals, Learning, Schedule, Settings = **7 items**

Items moved into Settings: Agents, MCP (Integrations tab), Providers. The Settings sidebar item replaces all three.

**Success criterion SC-001** (≤7 items) is satisfied.
