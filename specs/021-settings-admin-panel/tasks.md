# Tasks: Settings & Admin Panel

**Input**: Design documents from `specs/021-settings-admin-panel/`

**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Tests**: Not explicitly requested. No test tasks generated.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)

---

## Phase 1: Setup

**Purpose**: Create the new file and directory structure before any implementation begins.

- [x] T001 Create directory `web/src/pages/settings/` for adapter tab components

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the Settings shell and integrate it into App.tsx. All user story phases depend on this.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 Create `web/src/pages/Settings.tsx` — define `SettingsTabId` union type (`'providers' | 'routing' | 'agents' | 'integrations' | 'personality'`), `SettingsProps` interface with `defaultTab?: SettingsTabId`, and tab bar rendering with all 5 tab buttons using the existing button-group toggle pattern (same classes as Sections/Markdown toggle in `StepPersonality`). Tab content area renders `null` for all tabs initially. Export `Settings` component.
- [x] T003 In `web/src/App.tsx`, add `Settings` to the import list alongside other pages, add a Settings nav item to the `NAV` array (`{ label: 'Settings', icon: <Settings className={ICON_CLS} />, href: '/settings' }`), and add the `/settings` case to the page switch (`page === '/settings' ? SettingsPage : ...`). Do not yet remove any existing nav items or add legacy redirects.

**Checkpoint**: `npm run dev` shows a Settings icon in the sidebar; clicking it renders the Settings page with a tab bar (all tabs present, content area empty).

---

## Phase 3: User Story 1 — Settings Entry Point + Providers Tab (Priority: P1) 🎯 MVP

**Goal**: Operators can find Providers inside Settings. The standalone Providers sidebar item is removed.

**Independent Test**: Remove Providers nav item manually, click Settings → Providers tab, verify full provider add/edit/verify flow works inside the tab.

### Implementation

- [x] T004 [US1] In `web/src/pages/Settings.tsx`, add `import { Providers } from '../Providers'` and render `<Providers />` when `activeTab === 'providers'`. No prop changes to `Providers` — embed verbatim.
- [x] T005 [US1] In `web/src/App.tsx`, remove the `{ label: 'Providers', href: '/providers' }` entry from the `NAV` array. Add a page switch case so that navigating to `/providers` renders `<SettingsPage defaultTab="providers" />` instead of `<Providers />`. Update the catch-all (currently `else → Providers`) to render `<OperationsPortal />` (or `<SettingsPage />` if more appropriate) so no route silently falls through to Providers.

**Checkpoint**: Sidebar has no standalone Providers item. Clicking Settings shows Providers tab active. Provider CRUD flows (add, edit, verify, delete) work inside the tab. Legacy code calling `setPage('/providers')` lands on Settings with Providers tab selected.

---

## Phase 4: User Story 2 — Agents Tab (Priority: P2)

**Goal**: Operators manage agent definitions from Settings → Agents tab. Standalone Agents sidebar item removed.

**Independent Test**: Remove Agents nav item, click Settings → Agents tab, view agent list, open edit form for one agent, save a change, confirm it persists.

### Implementation

- [x] T006 [US2] In `web/src/pages/Settings.tsx`, add `import { Agents } from '../Agents'` and render `<Agents />` when `activeTab === 'agents'`. Embed verbatim.
- [x] T007 [US2] In `web/src/App.tsx`, remove `{ label: 'Agents', href: '/agents' }` from `NAV`. Add page switch case for `/agents` → `<SettingsPage defaultTab="agents" />`.

**Checkpoint**: Sidebar has no standalone Agents item. Settings → Agents tab shows full agent roster. Add/edit/enable/disable agent flows work inside the tab.

---

## Phase 5: User Story 3 — Integrations Tab (Priority: P2)

**Goal**: Operators manage MCP servers from Settings → Integrations tab. Standalone MCP sidebar item removed.

**Independent Test**: Remove MCP nav item, click Settings → Integrations tab, verify MCP server list renders, toggle one server enabled/disabled, confirm state persists.

### Implementation

- [x] T008 [US3] In `web/src/pages/Settings.tsx`, add `import { McpServers } from '../McpServers'` and render `<McpServers />` when `activeTab === 'integrations'`. Embed verbatim.
- [x] T009 [US3] In `web/src/App.tsx`, remove `{ label: 'MCP', href: '/mcp-servers' }` from `NAV`. Add page switch case for `/mcp-servers` → `<SettingsPage defaultTab="integrations" />`.

**Checkpoint**: Sidebar has no standalone MCP item. Settings → Integrations tab shows MCP server list. Add/edit/remove MCP server flows work inside the tab.

---

## Phase 6: User Story 4 — Routing Tab (Priority: P3)

**Goal**: Operators can edit model routing (function assignments) and cost controls from Settings → Routing tab, without re-running the onboarding wizard.

**Independent Test**: Click Settings → Routing tab, verify current `function_assignments` load and display, change one function's model assignment, click Save, confirm change persists via `fetchSetupDraft()` on next load.

### Implementation

- [x] T010 [US4] Create `web/src/pages/settings/RoutingTab.tsx`. On mount, call `fetchSetupDraft()` to load `function_assignments`. Use `useProviders()` to get the active providers list. Render a loading spinner while fetching. Render an inline error with a Retry button if the fetch fails.
- [x] T011 [US4] In `web/src/pages/settings/RoutingTab.tsx`, import `StepPrimeFunctionAssignments` and `WizardState` from `../../pages/Setup`. Adapt the loaded `function_assignments` and `providers` into the `WizardState` shape expected by `StepPrimeFunctionAssignments`. Wire the component's `onChange` to local state.
- [x] T012 [US4] In `web/src/pages/settings/RoutingTab.tsx`, add a Save button below the assignments form. On click, call `saveSetupDraft({ function_assignments: localState.functionAssignments })`. Show an inline success message (auto-dismiss after 3 seconds) on success. Show an inline error message on failure. Disable the Save button while saving.
- [x] T013 [US4] In `web/src/pages/Settings.tsx`, add `import { RoutingTab } from './settings/RoutingTab'` and render `<RoutingTab />` when `activeTab === 'routing'`.

**Checkpoint**: Settings → Routing tab loads current routing assignments, allows editing provider/model per function, saves successfully, and shows inline feedback.

---

## Phase 7: Personality Tab (FR-007)

**Goal**: Operators can edit Prime's personality profile (soul + operating sections) from Settings → Personality tab without re-running the wizard.

**Independent Test**: Click Settings → Personality tab, verify current Prime profile loads in the section editor, edit the Identity field, click Save, confirm the change is reflected in the profile API response.

### Implementation

- [x] T014 [P] Create `web/src/pages/settings/PersonalityTab.tsx`. On mount, call `fetchPrimeProfile()` and map the API response to `ProfileDraft` (imported from `../../pages/Setup`). Render a loading spinner while fetching. Render an inline error with a Retry button if the fetch fails.
- [x] T015 Import `StepPersonality` from `../../pages/Setup` and render it with the loaded `ProfileDraft` when data is available. Wire `onChange` to local state.
- [x] T016 Add a Save button below the personality form. On click, call `updatePrimeProfile({ soul: profile.soul, operating: profile.operating })`. Show inline success (auto-dismiss after 3 seconds) on success. Show inline error on failure. Disable Save while saving.
- [x] T017 In `web/src/pages/Settings.tsx`, add `import { PersonalityTab } from './settings/PersonalityTab'` and render `<PersonalityTab />` when `activeTab === 'personality'`.

**Checkpoint**: Settings → Personality tab loads Prime's current profile, allows editing all five sections (Identity, Voice & Tone, Decision Style, Default Behaviors, Approval Thresholds), saves successfully, and shows inline feedback.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Visual consistency, mobile strip update, sidebar count verification, and catch-all fixes.

- [x] T018 Verify sidebar item count is exactly 7 after all NAV removals: Circuit, Rooms, Goals, Approvals, Learning, Schedule, Settings. Fix any off-by-one if a removal was missed in earlier phases.
- [x] T019 In `web/src/App.tsx`, verify the mobile tab strip (the `lg:hidden` div with horizontal scroll, ~line 128) reflects the updated NAV — Providers, MCP, and Agents buttons should not appear. The strip is derived from `navItems` so this should be automatic; confirm by inspecting at narrow viewport.
- [x] T020 In `web/src/pages/Settings.tsx`, verify the `pageLabel` shown in the topbar breadcrumb reads "Settings" when on the Settings page. The label is derived from the NAV item label — confirm the label field is exactly `'Settings'` in the NAV entry added in T003.
- [x] T021 Review loading, empty, success, and error states in RoutingTab and PersonalityTab against the existing page patterns in `Providers.tsx` and `Agents.tsx`. Ensure spinner, error card, and success message styles are consistent.
- [x] T022 [P] Scan codebase for any hardcoded `setPage('/providers')`, `setPage('/agents')`, or `setPage('/mcp-servers')` calls outside App.tsx (e.g., in `Governance.tsx` or any other component) and update them to `setPage('/settings')` with an appropriate `defaultTab` if a specific tab is implied.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — **BLOCKS all user stories**
- **US1 (Phase 3)**: Depends on Foundational — must complete before US2/US3/US4 (sidebar count depends on all removals)
- **US2 (Phase 4)**: Depends on Foundational; can start after T002–T003 without waiting for US1
- **US3 (Phase 5)**: Depends on Foundational; can start after T002–T003 without waiting for US1/US2
- **US4 (Phase 6)**: Depends on Foundational; independent of US1/US2/US3
- **Personality (Phase 7)**: Depends on Foundational; independent of all other user stories
- **Polish (Phase 8)**: Depends on all earlier phases being complete

### User Story Dependencies

- **US1 (P1)**: No story dependencies — start after Foundational
- **US2 (P2)**: No story dependencies — start after Foundational (can run in parallel with US1)
- **US3 (P2)**: No story dependencies — start after Foundational (can run in parallel with US1/US2)
- **US4 (P3)**: No story dependencies — start after Foundational
- **Personality tab**: No story dependencies — start after Foundational

### Within Each User Story

- Settings shell content (tab render) before nav changes (so the tab has somewhere to land)
- Nav removal before legacy redirect (so the redirect case is needed)
- Core tab embed before polish

---

## Parallel Opportunities

```bash
# After Foundational phase (T002-T003), all story phases can run in parallel:
Task T004-T005  # US1: Providers tab + nav change
Task T006-T007  # US2: Agents tab + nav change
Task T008-T009  # US3: Integrations tab + nav change
Task T010-T013  # US4: Routing tab (sequential within itself)
Task T014-T017  # Personality tab (sequential within itself)

# Within Polish phase, T018, T021, T022 [P] can run in parallel with each other
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002–T003) — **critical gate**
3. Complete Phase 3: US1 (T004–T005)
4. **STOP and VALIDATE**: Settings nav item works, Providers tab shows full CRUD, legacy `/providers` route redirects correctly
5. Sidebar has at most 8 items (Agents + MCP not yet moved)

### Incremental Delivery

1. Setup + Foundational → Settings shell in sidebar (empty tabs)
2. Add US1 → Providers in Settings, Providers removed from sidebar
3. Add US2 → Agents in Settings, Agents removed from sidebar
4. Add US3 → MCP in Settings, MCP removed from sidebar (sidebar now at 7)
5. Add US4 → Routing tab live-editable
6. Add Personality tab → all 5 tabs populated
7. Polish → visual consistency confirmed

---

## Notes

- [P] tasks use different files or have no incomplete dependencies
- Each user story (US1–US3) is a 2-task phase: embed tab content, remove nav item + add redirect
- US4 and Personality tab are slightly heavier: 4 tasks each for the new adapter components
- No backend changes required across all phases
- The existing `Providers`, `Agents`, and `McpServers` page files are untouched
- `StepPrimeFunctionAssignments` and `StepPersonality` are already exported from `Setup.tsx` — no changes to that file required
