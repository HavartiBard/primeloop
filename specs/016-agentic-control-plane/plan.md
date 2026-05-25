# Implementation Plan: Agentic Control Plane

**Branch**: `slice5-durable-bootstrap` | **Date**: 2026-05-23 | **Spec**: `specs/016-agentic-control-plane/spec.md`

**Input**: Feature specification from `/specs/016-agentic-control-plane/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Build an operator-facing Agentic Control Plane where Prime is the single steering
interface for creating, monitoring, approving, and completing user goals. The
current codebase already provides a native Prime backend runtime, a routing layer,
a fleet executor, approval routes, and a web application. The shortest path is to
bootstrap Prime on top of those existing primitives, then add durable goal/work-item
state, truthful executable routing, a minimal durable maintenance team, and a
first-class recovery/learning loop.

Research on similar tools suggests the right blend for ACP is:
- OpenSwarm-style mission control visibility and unified approvals
- Hermes-style memory, skills, setup, and operational diagnostics
- OpenClaw-style per-agent isolation and gateway routing
- OpenAI Swarm-style lightweight handoff contracts for the initial bootstrap

ACP should borrow those strengths without copying their operator model: Prime stays
as the only steering interface and the system remains single-tenant and self-hosted.

## Technical Context

**Language/Version**: TypeScript 5.x on backend and web

**Primary Dependencies**: Express, pg, ws, React 18, Vite 6, TanStack Query,
Radix UI, Tailwind CSS 4

**Storage**: PostgreSQL for durable ACP records; local agent workspaces and runtime
state directories for isolated execution

**Testing**: Vitest, Supertest, Testing Library, DB-backed Vitest suite for backend

**Target Platform**: Linux-hosted backend with browser-based web control plane

**Project Type**: Web application with `backend/` and `web/` projects

**Performance Goals**: Operators can submit a goal and understand current status
within 2 minutes; blocked delegated work with a defined safe recovery path is
recorded and recovered or escalated within 5 minutes; completed goals produce an
operator-readable summary at least 90% of the time

**Constraints**: Single-tenant self-hosted deployment; Prime-only steering path;
durable records as source of truth; per-agent isolation; Prime is a native backend
service, not an `agents` row; Phase A Prime work stays limited to approved schema,
routing, queue, and service steps

**Scale/Scope**: One operator per instance coordinating a small durable operational
team plus ephemeral specialists across homelab, development, and personal-assistant
workflows

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code quality**: PASS — the plan builds on existing backend/web seams
  (`prime-agent`, `routing`, `fleet-executor`, `routes`, `ws`, `web/src`) instead
  of introducing a second orchestration core.
- **YAGNI**: PASS — the recommended initial durable team is Prime + one combined
  SRE/DevOps role + one Architect role, with domain specialists primarily handled as
  spawnable or dispatchable execution paths instead of a large always-on fleet.
- **SRE readiness**: PASS — the design centers durable goal/work-item state,
  approvals, blocked-state detection, recovery events, learning records, and an
  explicit maintenance owner for runtime/platform incidents.
- **UX consistency**: PASS — Prime remains the sole steering interface, while the
  control plane provides one unified workspace for goals, delegated activity,
  approvals, blockers, and results.
- **Visual polish**: PASS — the feature extends the existing web app as a single
  polished control plane rather than building disconnected domain-specific surfaces.
- **ACP architecture constraints**: PASS — Prime remains the only user-facing
  control path, durable records remain authoritative, per-agent isolation is
  preserved, and scope remains single-tenant.
- **Post-design re-check**: PASS — the research, data model, quickstart flows, and
  contracts maintain all gates above without unjustified platform expansion.

## Project Structure

### Documentation (this feature)

```text
specs/016-agentic-control-plane/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── control-plane-api.yaml
│   └── control-plane-events.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── prime-agent/
│   ├── routing/
│   ├── fleet-executor/
│   ├── routes/
│   ├── ws/
│   ├── events/
│   └── migrations/
└── tests/
    ├── prime-agent/
    ├── routing/
    ├── fleet-executor/
    ├── events/
    └── ws/

web/
├── src/
│   ├── components/
│   ├── hooks/
│   └── pages/
└── tests/
    ├── components/
    ├── hooks/
    └── pages/
```

**Structure Decision**: Use the existing `backend/` + `web/` application split.
Prime intake, runtime-truth routing, durable work state, approvals, recovery, and
live updates belong in backend modules already present in the codebase. The
operator workspace, goal detail, approval queue, and result summaries belong in the
existing web application.

## Phase 0: Research Output

Research decisions are captured in `specs/016-agentic-control-plane/research.md`.
The research resolves all planning unknowns and adds four decision layers:

1. codebase-derived bootstrap path for the native Prime runtime,
2. competitive lessons from OpenSwarm, Hermes Agent, OpenClaw, and OpenAI Swarm,
3. minimal durable team design for platform maintenance, and
4. a concrete self-healing/self-improvement loop.

## Phase 1: Design Output

- **Data model**: `specs/016-agentic-control-plane/data-model.md`
- **HTTP contract**: `specs/016-agentic-control-plane/contracts/control-plane-api.yaml`
- **Live update contract**: `specs/016-agentic-control-plane/contracts/control-plane-events.md`
- **Validation flows**: `specs/016-agentic-control-plane/quickstart.md`

## Recommended Bootstrap Path

### Step 1: Make Prime truthful before making it ambitious
Implement runtime-truth routing and blocked outcomes first, using the existing
Prime service, queue, event loop, and routing layer. Prime must only route to
executable durable staff or spawnable specialists.

### Step 2: Add durable goal/work-item control-plane records
Back the operator experience with durable `Goal`, `WorkItem`, `Approval`,
`RecoveryEvent`, and `LearningRecord` entities. The web app should render those
records directly instead of relying on ephemeral session state.

### Step 3: Bootstrap the minimum durable team
Provision:
- **Prime** as the singleton orchestrator
- **SRE/DevOps** as one combined durable maintenance role
- **Architect** as the durable quality, template, and playbook owner

Keep homelab, development, and personal-assistant execution paths mostly ephemeral
or otherwise runtime-dispatchable until demand proves they need their own durable
presence.

### Step 4: Close the self-healing loop
When work blocks or fails, Prime records a `RecoveryEvent`, retries/reroutes where
safe, or escalates to the SRE/DevOps durable role. This produces truthful operator
status and reduces silent dead-queue failure modes.

### Step 5: Close the self-improvement loop
After completion or terminal failure, store `LearningRecord` artifacts. Repeated
patterns feed Architect-led review and approved updates to templates, playbooks,
routing policy, and Prime guidance.

## Minimal Durable Team Recommendation

```text
Prime
├── SRE/DevOps (durable)
│   ├── runtime health
│   ├── deploy/config changes
│   ├── queue and harness recovery
│   └── incident response / escalation
└── Architect (durable)
    ├── grading review
    ├── playbook and template improvement
    ├── cross-cutting consistency
    └── proposed system improvements
```

**Reasoning**: This is the smallest always-on team that can keep the platform
running, improve it safely, and avoid premature role explosion. If workload later
proves it necessary, SRE and DevOps can be split.

## Implementation Order Recommendation

1. `015-prime-routing-runtime-truth`
2. `016-agentic-control-plane` goal/work-item control plane
3. `003-durable-staff-bootstrap` with combined SRE/DevOps + Architect
4. approval and live update polish
5. `013-grading-self-improvement`

This ordering gives ACP a truthful orchestrator first, a usable operator control
plane second, a maintainable durable team third, and a learning flywheel fourth.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No constitutional violations or justified exceptions identified in planning.
