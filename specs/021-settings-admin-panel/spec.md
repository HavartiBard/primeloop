# Feature Specification: Settings & Admin Panel

**Feature Branch**: `021-settings-admin-panel`

**Created**: 2026-06-01

**Status**: Draft

**Input**: User description: "review the settings and admin panel in odysseus interface, any inspiration on how we can rearrange model instantiation, providers, search settings, integrations et, obviously we need to extend it to allow for Agent management as well. but we can probably move several things out of the side menu and into settings"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Navigate to Settings and find Providers (Priority: P1)

An operator opens the interface and wants to change which LLM provider is active or update an API key. Instead of hunting through a dedicated sidebar nav item, they click a single "Settings" entry in the sidebar and land on the Settings panel, where Providers is one of the first tabs. They make their change and return to operations.

**Why this priority**: Providers and model routing are the most frequently reconfigured items post-onboarding. They must be immediately discoverable in any final nav structure.

**Independent Test**: Can be fully tested by removing the standalone Providers nav item, clicking the Settings nav item, finding the Providers tab, and verifying the full provider add/edit/verify flow still works.

**Acceptance Scenarios**:

1. **Given** the sidebar has a Settings nav item, **When** the operator clicks it, **Then** a Settings panel opens with a Providers tab visible and active by default.
2. **Given** the Providers tab is open, **When** the operator edits a provider's API key and saves, **Then** the change is persisted and the provider shows its updated verification status.
3. **Given** the sidebar previously had a standalone Providers nav item, **When** looking at the sidebar after this change, **Then** the standalone Providers item is gone and Settings replaces it.

---

### User Story 2 - Manage Agent definitions from Settings (Priority: P2)

An operator wants to review which specialist agents are registered, see their capabilities, adjust their configuration, or add a new agent template. They find "Agents" as a tab inside Settings rather than a separate sidebar nav item. From there they can see the full agent roster, edit an agent's configuration, and understand its routing and model assignments.

**Why this priority**: Agent management is the primary new capability this feature adds. Moving it to Settings rather than a standalone page makes it feel like system configuration rather than a live operational view.

**Independent Test**: Can be fully tested by navigating to Settings → Agents tab, viewing the registered agent list, editing one agent's display name and model assignment, saving, and confirming the update is reflected.

**Acceptance Scenarios**:

1. **Given** the operator is in Settings → Agents, **When** the page loads, **Then** all registered agents are listed with their name, type, assigned model, and status.
2. **Given** an agent is listed, **When** the operator opens its detail view and changes the assigned model, **Then** the change is saved and the agent detail reflects the new model on next open.
3. **Given** no agents are registered, **When** the operator navigates to Settings → Agents, **Then** an empty state is shown with a call-to-action to register or onboard a first agent.

---

### User Story 3 - Manage MCP Server integrations from Settings (Priority: P2)

An operator wants to add a new MCP server or disable an existing one. They find "Integrations" as a tab inside Settings, which consolidates MCP servers and any future integration types (search backends, webhook endpoints, etc.) under one roof, rather than having a standalone MCP nav item.

**Why this priority**: MCP servers are a configuration concern, not an operational view. Moving them to Settings reduces sidebar clutter for operators who never change them.

**Independent Test**: Can be fully tested by navigating to Settings → Integrations tab, verifying the existing MCP server list renders, toggling one server enabled/disabled, and confirming the state persists.

**Acceptance Scenarios**:

1. **Given** the operator is in Settings → Integrations, **When** the page loads, **Then** all configured MCP servers are listed with name, endpoint, and enabled state.
2. **Given** an MCP server is listed, **When** the operator disables it and saves, **Then** the server is no longer offered as an active integration and shows as disabled in the list.
3. **Given** the operator wants to add a new MCP server, **When** they use the add form in Integrations, **Then** the new server appears in the list and is available to agents.

---

### User Story 4 - Edit model routing and cost controls from Settings (Priority: P3)

An operator wants to adjust which model handles planning versus dispatching tasks, or change the monthly token budget. They find these under Settings → Routing (or Settings → Providers), with the same routing row controls available in the onboarding wizard but now editable live post-launch.

**Why this priority**: Routing and cost controls are low-frequency but important post-launch edits. They don't need a dedicated nav item but must be accessible without re-running the wizard.

**Independent Test**: Can be fully tested by navigating to Settings → Routing, changing the planning route to a different model, saving, and confirming Prime uses the new routing on next dispatch cycle.

**Acceptance Scenarios**:

1. **Given** the operator is in Settings → Routing, **When** the page loads, **Then** the current planning, dispatching, and discussion routing assignments are shown pre-filled.
2. **Given** the operator changes the planning route and saves, **Then** the new routing is persisted and active; no restart is required.
3. **Given** the monthly token budget is configured, **When** the operator edits it in Settings → Routing, **Then** the new budget takes effect on the next billing cycle check.

---

### User Story 5 - Sidebar is cleaner after reorganization (Priority: P3)

After the reorganization, the sidebar shows only operational views: Circuit, Rooms, Goals, Approvals, Learning, Schedule — and a single Settings icon at the bottom. Configuration items (Providers, MCP, Agents-as-config) are no longer top-level nav items cluttering the operational view.

**Why this priority**: Sidebar clarity is the primary UX motivation behind this whole initiative. It must be verifiable as a standalone outcome.

**Independent Test**: Can be fully tested by counting sidebar items before and after — the number of top-level nav items must decrease, and all removed items must be reachable through Settings.

**Acceptance Scenarios**:

1. **Given** the redesign is complete, **When** looking at the sidebar, **Then** there are no more than 7 nav items (operational views + Settings), down from the current 9+.
2. **Given** an operator used to navigate to `/providers` directly, **When** the redesign is live, **Then** navigating to `/settings/providers` (or clicking Settings → Providers) achieves the same result.

---

### Edge Cases

- What happens when the operator navigates directly to a removed route (e.g., `/providers`)? A redirect to the equivalent Settings tab must be in place.
- How does the Settings panel behave on mobile/narrow viewports where the sidebar collapses? The Settings content must be scrollable and the tab list must not overflow without horizontal scroll.
- What if settings changes fail to persist (API error)? The panel must show an inline error without losing the draft state, allowing the operator to retry.
- What happens when an agent in the Agents tab is currently running a task? The edit form must warn the operator that changes will take effect after the current task completes, not interrupt it.

## Constitution Alignment *(mandatory)*

- **Code Quality Plan**: Reuse existing wizard step components (`StepProviders`, `StepRouting`, `StepPersonality`, etc.) as the content for Settings tabs — no duplication of form logic. Each tab is independently testable. Changes go through the existing API layer.
- **YAGNI Check**: One new Settings shell component with a tab switcher. No new abstraction beyond what is needed to host existing step components in a post-wizard context. Agent management tab reuses existing agent API types and list components.
- **Reliability & Operations**: All settings mutations emit the same structured error responses as the existing endpoints. Form saves are atomic per-tab; partial saves are not possible. Failed saves surface inline errors. No polling required.
- **UX Consistency**: Settings panel uses the same design tokens, panel styles, and input classes (`INPUT_CLS`, `BTN_PRIMARY`, `BTN_SECONDARY`) already established in Setup.tsx. Tab labels match the terminology used in the onboarding wizard.
- **Design Consistency**: Tab bar follows the existing button-group toggle pattern used throughout the wizard. Panel content scrolls independently from the tab bar. No new color tokens or component primitives are introduced.
- **ACP Architecture Constraints**: No changes to Prime routing or agent delegation logic. Settings mutations go through existing REST endpoints. Sidebar nav restructuring is a pure frontend change — no backend route changes required.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a single Settings entry point in the sidebar that opens a multi-tab settings panel.
- **FR-002**: Settings panel MUST include tabs for: Providers, Routing, Agents, Integrations, and Personality (Prime profile).
- **FR-003**: Providers tab MUST expose the same add/edit/verify/delete provider capabilities currently available on the `/providers` page and in the onboarding wizard.
- **FR-004**: Routing tab MUST expose model routing assignments (planning, dispatching, discussion) and monthly token budget, editable live without re-running the wizard.
- **FR-005**: Agents tab MUST list all registered agents with name, type, model assignment, and status; operators MUST be able to view and edit agent configuration from this tab.
- **FR-006**: Integrations tab MUST list all configured MCP servers with the ability to add, enable/disable, and remove entries.
- **FR-007**: Personality tab MUST expose Prime's soul and operating profile (identity, voice/tone, decision style, default behaviors, approval thresholds) using the existing section/markdown toggle editor.
- **FR-008**: The sidebar MUST be reduced to operational views only; Providers and MCP Servers MUST be removed as standalone sidebar nav items.
- **FR-009**: Any route previously served by a removed sidebar item MUST redirect to its equivalent Settings tab.
- **FR-010**: Settings panel MUST preserve unsaved draft state within a tab if the operator switches between tabs, but MAY discard it on full panel close.
- **FR-011**: All settings mutations MUST surface inline success and error feedback without full page reload.

### Key Entities

- **Settings Tab**: A named configuration section within the Settings panel. Has an id, label, and associated content view. Tabs do not have independent URLs beyond an optional query parameter.
- **Agent Definition**: A registered specialist agent with a name, type, capability tags, assigned provider/model, and active status. Distinct from a running agent session.
- **Provider**: An LLM provider configuration (name, type, base URL, credential state, available models). Already exists; surfaced in new context.
- **Integration**: An external service connection (initially MCP servers); may extend to search backends, webhook endpoints, or credential brokers in future.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The sidebar contains 7 or fewer top-level navigation items after the redesign, verified by visual inspection and automated component test.
- **SC-002**: All settings mutations (provider save, routing update, agent edit, MCP toggle) are covered by automated verification and pass before release.
- **SC-003**: An operator can reach any previously top-level configuration page in 2 clicks or fewer from any operational view (click Settings → click tab).
- **SC-004**: Operational failures in the Settings panel (save errors, load errors) emit actionable inline messages and can be diagnosed without leaving the panel.
- **SC-005**: No regression in the existing provider verification flow, routing assignment display, or Prime personality editor — verified by test suite and manual walkthrough.

## Assumptions

- The onboarding wizard (Setup.tsx) remains unchanged; Settings is a post-wizard configuration surface, not a replacement for the wizard.
- The existing wizard step components (`StepProviders`, `StepRouting`, `StepPersonality`) can be reused inside the Settings panel with minimal prop adaptation — they are already stateless and prop-driven.
- Agent management in this feature covers viewing and editing existing agent definitions; spawning new ephemeral agents remains an operational action in the Circuit view.
- "Integrations" initially means MCP servers only; future integration types (search, webhooks) will add tabs or sections within Integrations without requiring a new top-level settings tab.
- The governance/rules page (`/governance`) remains accessible from the topbar button and is not moved into Settings for this iteration.
- Redirect behavior for removed routes is a frontend-only concern; no backend route changes are needed.
