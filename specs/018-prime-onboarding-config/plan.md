# Implementation Plan: Prime Onboarding Configuration

**Branch**: `018-prime-onboarding-config` | **Date**: 2026-05-26 | **Spec**: `specs/018-prime-onboarding-config/spec.md`

**Input**: Feature specification from `/specs/018-prime-onboarding-config/spec.md`

## Summary

Rework onboarding to keep the existing wizard flow while adding: provider connection/readiness (cloud + local), required Prime function assignment (orchestration, planning, coding/execution, review/validation, platform maintenance), Prime config review/editing, optional plugin selection, and Prime launch into a setup conversation that proposes a team plan requiring explicit user confirmation before agent creation.

## Technical Context

**Language/Version**: TypeScript (Node.js backend + React frontend)

**Primary Dependencies**: Express-style backend routes, React UI, existing provider registry + Prime config services

**Storage**: SQLite/Postgres via ACP DB layer (`backend/src/db.ts`) plus existing encrypted provider-secret handling

**Testing**: Vitest/Jest-style backend and frontend tests under `backend/tests` and `web/tests`

**Target Platform**: Linux server for backend; browser for web UI

**Project Type**: Web application (backend + frontend)

**Performance Goals**: Keep onboarding interactions responsive; validation and readiness checks are recoverable and user-visible

**Constraints**: No raw credential exposure, Prime is a native backend service (not an `agents` row), single-tenant assumptions

**Scale/Scope**: Single-operator onboarding flow with durable resume state

## Constitution Check

- **Code quality**: Implemented by route/service boundaries with explicit validation and recoverable errors.
- **YAGNI**: Added only required schema/state for onboarding draft, plugin choice, launch validation, and team confirmation.
- **SRE readiness**: Added operational logging for provider verification, launch validation, Prime launch, plugin inventory, and team-plan confirmation failures.
- **UX consistency**: Preserved wizard progression and added explicit loading/empty/success/error/retry states.
- **Visual polish**: Reused existing Setup patterns and extended with assignment matrix, plugin step, and launch/team confirmation views.
- **ACP architecture constraints**: Preserved Prime native-service model and durable ACP records as source of truth.
- **Complexity tracking**: No constitutional exceptions requiring override.

## Project Structure

### Documentation (this feature)

```text
specs/018-prime-onboarding-config/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── db.ts
│   ├── registry.ts
│   ├── routes/
│   │   ├── setup.ts
│   │   ├── providers.ts
│   │   └── agents.ts
│   └── prime-agent/
│       ├── config.ts
│       ├── service.ts
│       └── model-capability.ts
└── tests/
    ├── setup.route.test.ts
    ├── providers.route.test.ts
    ├── prime-agent-config.test.ts
    └── prime-agent-team-plan.test.ts

web/
├── src/
│   ├── api.ts
│   ├── types.ts
│   └── pages/
│       ├── Setup.tsx
│       └── Agents.tsx
└── tests/
    ├── fixtures/onboarding.ts
    └── pages/
        ├── Setup.providers.test.tsx
        ├── Setup.assignments.test.tsx
        ├── Setup.prime-config.test.tsx
        ├── Setup.plugins.test.tsx
        └── Setup.launch-team.test.tsx
```

**Structure Decision**: Use the existing backend/web split and extend current setup routes, prime config/service helpers, and Setup wizard UI. Keep implementation in current module boundaries instead of introducing a parallel onboarding system.

## Complexity Tracking

No constitution violations recorded.
