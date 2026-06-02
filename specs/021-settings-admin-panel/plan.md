# Implementation Plan: Settings & Admin Panel

**Branch**: `021-settings-admin-panel` | **Date**: 2026-06-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/021-settings-admin-panel/spec.md`

## Summary

Consolidate configuration-oriented sidebar items (Providers, MCP Servers, Agents) and post-wizard configuration surfaces (Routing, Prime Personality) into a single tabbed **Settings** panel reachable from the sidebar. The existing self-contained page components (`Providers.tsx`, `Agents.tsx`, `McpServers.tsx`) are embedded as tab content. Two new thin tab components (`RoutingTab`, `PersonalityTab`) wire existing wizard step components to live API endpoints. The sidebar shrinks from 9 items to 7.

## Technical Context

**Language/Version**: TypeScript 5.x (React 18 + Vite frontend, Node.js/Express backend)

**Primary Dependencies**: React 18, TanStack Query v5, Tailwind CSS, Lucide React icons

**Storage**: PostgreSQL (backend, via existing API layer — no direct DB access from frontend)

**Testing**: Vitest + Testing Library (frontend), Vitest (backend)

**Target Platform**: Web browser (desktop-primary; mobile/narrow viewport must be usable)

**Project Type**: Web application (monorepo with `web/` and `backend/`)

**Performance Goals**: Tab switch and content render under 100ms; no new polling or background data fetching introduced

**Constraints**:
- No react-router — navigation is manual `page` state in `App.tsx`
- Reuse existing self-contained page components verbatim where possible
- No new backend routes required; all necessary API endpoints already exist
- Design tokens, panel classes, and form primitives from existing codebase only

**Scale/Scope**: Single-tenant, one operator; ~5 settings tabs; ~3 moved sidebar items

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code quality**: Existing page components (`Providers.tsx`, `Agents.tsx`, `McpServers.tsx`) are embedded as tab content with zero duplication of form logic. The `Settings.tsx` shell is a thin tab router only. Two new tab components (`RoutingTab`, `PersonalityTab`) are thin adapters that wire existing step components to live API calls — no business logic duplicated from the wizard.

- **YAGNI**: One new page component (`Settings.tsx`), two new adapter tab components, and minor changes to `App.tsx` (nav array + page switch). No new abstractions, no new state management, no new hooks beyond what is needed to load and save routing and profile data in the settings context. The tab switcher uses the existing button-group toggle pattern already in the codebase.

- **SRE readiness**: All settings mutations go through existing API endpoints that already have error handling. The tab components surface inline success/error feedback using the existing status-badge pattern. No new operational signals required; existing API error paths are unchanged.

- **UX consistency**: Settings panel uses the existing design token set, input classes (`INPUT_CLS`, `LABEL_CLS`), button classes (`BTN_PRIMARY`, `BTN_SECONDARY`), and panel border/background styles established in `Setup.tsx`. Tab labels match terminology used in the wizard (`Providers`, `Routing`, `Agents`, `Integrations`, `Personality`). Loading, empty, success, and error states follow existing patterns from the embedded pages.

- **Visual polish**: Tab bar uses the existing button-group pattern (same as Sections/Markdown toggle in `StepPersonality`, same as Local/Git toggle in `StepWorkspace`). No new color tokens. Tab content scrolls independently. Panel layout is consistent with other full-page views.

- **ACP architecture constraints**: No change to Prime routing logic or agent delegation. Settings mutations use existing REST endpoints — source of truth remains the database. Per-agent isolation is unaffected. This is a purely frontend reorganization of configuration surfaces.

No constitutional violations. Complexity tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/021-settings-admin-panel/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code

```text
web/src/
├── App.tsx                          # MODIFY: remove Providers/MCP/Agents from NAV, add Settings, extend page switch
├── pages/
│   ├── Settings.tsx                 # NEW: tabbed settings shell
│   ├── settings/
│   │   ├── RoutingTab.tsx           # NEW: routing + cost controls adapter
│   │   └── PersonalityTab.tsx       # NEW: Prime personality adapter
│   ├── Providers.tsx                # EMBED as tab (no changes)
│   ├── Agents.tsx                   # EMBED as tab (no changes)
│   └── McpServers.tsx               # EMBED as tab (no changes)
└── [all other files unchanged]

backend/                             # NO CHANGES
```

**Structure Decision**: Web application (Option 2). All changes are confined to `web/src/`. No backend modifications.

## Complexity Tracking

> No violations. Table omitted.
