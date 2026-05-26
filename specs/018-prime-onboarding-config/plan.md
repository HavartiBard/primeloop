# Implementation Plan: Prime Onboarding Configuration

**Branch**: `018-prime-onboarding-config` | **Date**: 2026-05-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/018-prime-onboarding-config/spec.md`

## Summary

Rework the existing setup wizard into a Prime-first onboarding flow that keeps the current provider → routing → profile/rules/workspace → launch shape, but expands it to support cloud and local provider connection, per-function Prime model assignment, default Prime configuration review, optional pi plugin selection, and a post-launch Prime conversation that proposes a user-confirmed starter team. The implementation should reuse the current Express/PostgreSQL backend, React setup UI, provider registry, encrypted provider key handling, Prime configuration tables, Prime module registry, model capability checks, and runtime thread creation. OpenSwarm research informs the UX pattern: visible capability selection, tool/plugin choice as optional extension, strong human confirmation before agent creation, and local-first recoverability.

## Technical Context

**Language/Version**: TypeScript 5.x; backend uses Node.js with Express; frontend uses React 18 with Vite.

**Primary Dependencies**: Backend: Express, pg, OpenAI/Anthropic SDKs, ws, node-cron, existing ACP runtime/Prime services. Frontend: React, @tanstack/react-query, Radix Dialog, lucide-react, Tailwind/Vite styling.

**Storage**: PostgreSQL via existing `pg` pool and idempotent migrations in `backend/src/db.ts`; encrypted provider secrets via existing `backend/src/crypto.ts`; Prime config stored in `prime_agent_config` JSONB fields and related Prime module tables.

**Testing**: Vitest for backend and frontend. Relevant existing suites include `backend/tests/setup.route.test.ts`, `backend/tests/providers.route.test.ts`, Prime config/module tests where present, and web component/hook tests under `web/tests`.

**Target Platform**: Self-hosted single-tenant ACP deployment: Linux server backend plus browser-based React UI.

**Project Type**: Web application with Express API backend and React frontend.

**Performance Goals**: First-time users can complete provider setup and reach Prime configuration review without external documentation; setup screens should remain responsive while provider/model discovery is pending; provider/model discovery failures should return recoverable states within the existing short discovery timeouts.

**Constraints**: Preserve Prime as a native backend service, not an `agents` table row. Preserve existing encrypted secret handling and never expose stored provider secrets. Keep plugin selection optional and defer detailed plugin-specific configuration until after Prime is running. Required Prime functions must have valid provider/model assignments before launch, but may reuse the same provider/model. Do not introduce a plugin marketplace, multi-user onboarding, billing, or organization policy scope.

**Scale/Scope**: Single operator onboarding one ACP instance; default Prime function set covers orchestration, planning, coding/execution, review/validation, and platform maintenance. Expected provider count is small enough for wizard UI and JSONB configuration review; future configured functions may be rendered dynamically.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code quality**: Pass. The plan keeps boundaries around existing setup routes, provider registry, Prime config/service, and setup UI. New concepts are modeled as onboarding/session DTOs, Prime function assignments, plugin choices, and team plan records rather than broad rewrites.
- **YAGNI**: Pass. New surfaces are limited to accepted onboarding requirements. The plugin step remains selection/placeholder only; plugin installation marketplace, advanced policy engines, and multi-user setup are explicitly excluded.
- **SRE readiness**: Pass. Provider verification, model discovery, config validation, Prime launch, and team creation all require explicit ready/verifying/failed/saved/launching/launched states with recoverable user actions and backend error logging.
- **UX consistency**: Pass. The existing setup wizard progression is retained and extended. Labels should use existing ACP terms: providers, models, Prime, routing/function assignment, rules, workspace, plugins, launch, and team plan.
- **Visual polish**: Pass. Reuse current setup cards, progress states, provider/model warning banners, summary sections, and launch affordances. New UI patterns are limited to a Prime function assignment matrix, plugin placeholder/selection panel, and team confirmation summary.
- **ACP architecture constraints**: Pass. Prime remains a native service configured through durable records. User intent after onboarding enters through the launched Prime conversation. Agents are created only after user confirmation and should use existing agent creation/delegation paths, not the deprecated Prime-as-agent-row design.
- **Complexity tracking**: No constitutional violations identified.

## Project Structure

### Documentation (this feature)

```text
specs/018-prime-onboarding-config/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── onboarding-api.md
│   └── onboarding-ui.md
└── tasks.md                 # generated later by /speckit.tasks
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── db.ts                         # idempotent schema additions for onboarding progress/config where required
│   ├── routes/
│   │   ├── setup.ts                  # onboarding status, provider/model discovery, completion/launch flow
│   │   ├── providers.ts              # provider CRUD and model capability checks reused by onboarding
│   │   └── prime-agent.ts            # Prime launch/config endpoints reused or extended as needed
│   ├── registry.ts                   # provider persistence and encrypted key handling reuse
│   └── prime-agent/
│       ├── config.ts                 # model preferences and default function assignment schema
│       ├── modules/                  # existing Prime modules/config review inputs
│       ├── service.ts                # launch/session behavior
│       └── actions.ts                # team creation confirmation path if dispatched through Prime actions
├── tests/
│   ├── setup.route.test.ts
│   ├── providers.route.test.ts
│   └── prime-agent*.test.ts          # add or extend where Prime launch/team confirmation behavior lives

web/
├── src/
│   ├── api.ts                        # onboarding API client methods and typed responses
│   ├── types.ts                      # onboarding DTOs, function assignment, plugin choice, team plan types
│   ├── hooks/
│   │   ├── useSetupStatus.ts
│   │   └── useProviders.ts
│   └── pages/
│       ├── Setup.tsx                 # reworked wizard flow
│       ├── Providers.tsx             # reuse provider/model components where practical
│       └── Agents.tsx                # target surface for created/confirmed team visibility if needed
└── tests/
    ├── pages/Setup*.test.tsx         # add if page-level tests are organized this way
    ├── components/*.test.tsx
    └── hooks/*.test.ts
```

**Structure Decision**: Use the existing backend/web application structure. Keep onboarding orchestration in `backend/src/routes/setup.ts` unless task decomposition shows a focused helper module is needed for validation/defaults. Keep frontend wizard changes in `web/src/pages/Setup.tsx` initially, extracting local components only when the file becomes harder to test or reuse.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| None | N/A | N/A |

## Phase 0: Research Summary

Research is captured in [research.md](./research.md). Decisions resolve the major design questions for preserving current onboarding, OpenSwarm-inspired capability selection, provider/model assignment, credential handling, plugin scope, Prime launch, and team confirmation.

## Phase 1: Design Summary

Design artifacts produced:

- [data-model.md](./data-model.md): onboarding session, provider/model readiness, Prime function assignments, Prime configuration, plugin choices, launch, setup conversation, and team plan state.
- [contracts/onboarding-api.md](./contracts/onboarding-api.md): API contract for status, provider discovery, draft persistence, validation, completion/launch, plugin choices, and team confirmation.
- [contracts/onboarding-ui.md](./contracts/onboarding-ui.md): UI contract for wizard steps, states, validation, and acceptance behavior.
- [quickstart.md](./quickstart.md): acceptance walkthroughs and verification focus.

## Post-Design Constitution Check

- **Code quality**: Pass. The design uses narrow DTOs and validation rules tied to existing routes/services rather than broad new subsystems.
- **YAGNI**: Pass. Plugin support is intentionally selection-only during onboarding; no marketplace, policy engine, or multi-tenant role model is introduced.
- **SRE readiness**: Pass. Data model and contracts include recoverable states for verification, discovery, validation, launch, and team creation.
- **UX consistency**: Pass. UI contract keeps the existing wizard sequence while inserting the required Prime function, plugin, and team confirmation behaviors.
- **Visual polish**: Pass. Contracts call for reuse of current cards, progress, warning, and summary patterns.
- **ACP architecture constraints**: Pass. Durable records remain authoritative; Prime is launched as native service; team creation requires user confirmation.

No unresolved clarifications remain.
