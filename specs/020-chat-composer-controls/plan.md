# Implementation Plan: Chat Composer Controls

**Branch**: `020-chat-composer-controls` | **Date**: 2026-06-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/020-chat-composer-controls/spec.md`

## Summary

Enhance the ACP chat input to let operators configure agent execution at send time. Operators will select the model, toggle between planning and agent mode, attach files/images, add companion prompts, and enable or disable tool categories before submitting a message. The composer will show a `<prime>...` placeholder until the operator begins typing.

## Technical Context

**Language/Version**: TypeScript (React 18 frontend, Node.js backend)

**Primary Dependencies**: React, TanStack Query, existing ACP runtime event/thread APIs

**Storage**: Existing ACP database records for messages, sessions, work items, delegations, approvals, and tool invocations (no new persistence required)

**Testing**: Vitest + Testing Library for web; Vitest for backend contract/error-shape coverage where needed

**Target Platform**: Browser UI for operators in ACP web app

**Project Type**: Web application (backend + frontend)

**Performance Goals**: Smooth composer interactions with under 100ms perceived latency for toggles, uploads, and local send-state transitions

**Constraints**: Preserve deterministic chronology of messages; no changes to Prime routing or durable-record authority; reuse existing ACP chat input patterns and status messaging; ACP chat input only, with Odysseus/OpenWeb UI treated as inspiration only

**Scale/Scope**: ACP chat input surface where operators submit agent chat messages

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code quality**: Keep ACP chat input composer behavior consistent and localized to clear UI/state boundaries; verify primary flows (empty draft, edit, attachments, send) and failure states (validation errors, upload failures, unavailable selections).
- **YAGNI**: This feature adds only per-message composer controls required by the spec. No new subsystems, speculative abstraction layers, or extra configuration surfaces are introduced.
- **SRE readiness**: Composer failures must be diagnosable via clear user-facing error states and existing backend error shapes. Validation rejections, upload failures, and unavailable selections must fail predictably without losing draft state.
- **UX consistency**: The ACP chat input must present consistent controls, terminology, and draft states for empty, editing, uploading, ready-to-send, sending, success, and error conditions.
- **Visual polish**: Reuse existing ACP input styling, spacing, chips, toggles, and status messaging patterns rather than introducing new visual systems.
- **ACP architecture constraints**: Prime remains the sole steering interface; durable backend records remain authoritative; this feature changes only how the ACP chat input shapes message submission.
- **Complexity tracking**: No constitutional violations.

## Project Structure

### Documentation (this feature)

```text
specs/020-chat-composer-controls/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md
```

### Source Code (repository root)

```text
web/
├── src/
│   ├── components/
│   │   ├── CollaborationRoomsView.tsx
│   │   └── agentCanvas/
│   │       └── AgentActivityTimeline.tsx
│   ├── lib/
│   │   ├── chatDisplayEvents.ts
│   │   └── displayStatus.ts
│   └── types.ts
└── tests/
    └── pages|components

backend/
├── src/
│   ├── db.ts
│   └── routes|services
└── tests/
```

**Structure Decision**: Implement the feature in existing ACP web composer surfaces, centered on `web/src/components/CollaborationRoomsView.tsx` with supporting types/utilities as needed. Reuse existing backend message delivery contracts rather than creating new APIs.

## Complexity Tracking

No violations recorded.
