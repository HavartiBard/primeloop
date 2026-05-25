<!--
Sync Impact Report
- Version change: 0.2.0 -> 1.0.0
- Modified principles:
  - I. Three-Tier Agent Model -> I. Code Quality Is Non-Negotiable
  - II. Prime Is the Sole Steering Interface -> II. YAGNI Over Premature Complexity
  - III. Durable Artifacts of Record -> III. Reliability Is a Feature
  - IV. Per-Agent Isolation Is Mandatory -> IV. User Experience Must Be Easy and Consistent
  - V. Layered Tooling Contracts -> V. Visual Design Must Feel Slick and Intentional
- Added sections:
  - Architecture Constraints
  - Delivery & Review Standards
- Removed sections:
  - System Primitives
- Templates requiring updates:
  - ✅ updated: .specify/templates/plan-template.md
  - ✅ updated: .specify/templates/spec-template.md
  - ✅ updated: .specify/templates/tasks-template.md
  - ✅ reviewed, no file present: .specify/templates/commands/
- Follow-up TODOs:
  - None
-->
# Agent Control Plane Constitution

ACP is a self-hosted Personal Chief of Staff for one human, running on that
operator's own server. ACP exists to turn conversational intent into async-first,
durable execution without requiring minute-by-minute supervision.

## Core Principles

### I. Code Quality Is Non-Negotiable
Production code MUST be clear, reviewable, and maintainable. Changes MUST keep
modules cohesive, names explicit, failure paths handled, and behavior covered by
verification appropriate to the risk and surface area touched. Duplication MUST be
removed when it creates maintenance risk, but abstraction MUST not be introduced
without a concrete present need. Rationale: ACP is long-lived infrastructure and
product code; unclear code slows delivery and silently raises operational risk.

### II. YAGNI Over Premature Complexity
The codebase MUST prefer the simplest design that satisfies today's accepted
requirements. New abstractions, dependencies, services, flags, configuration
surfaces, and extension points MUST be justified by an active use case rather than
speculation. Plans and reviews MUST reject "maybe later" architecture unless it
reduces current complexity more than it adds. Rationale: unnecessary flexibility
creates drag, hides bugs, and makes the product harder to operate and evolve.

### III. Reliability Is a Feature
SRE principles MUST shape delivery from the start. Systems and features MUST be
observable, fail predictably, degrade safely, and support diagnosis without heroics.
Operationally relevant changes MUST define logging, metrics, health signals,
alertable failure modes, and rollback or recovery expectations proportionate to the
risk. Rationale: for an always-on control plane, reliability is part of the user
experience, not a backend afterthought.

### IV. User Experience Must Be Easy and Consistent
Primary workflows MUST be easy to discover, easy to understand, and consistent
across surfaces. Features MUST minimize operator effort, preserve predictable
terminology, and handle loading, empty, success, and error states intentionally.
If a user needs special knowledge to complete a routine task, the design is not yet
good enough. Rationale: ACP is a control product; friction, ambiguity, and mixed
interaction patterns directly reduce trust and usefulness.

### V. Visual Design Must Feel Slick and Intentional
The interface MUST feel polished without becoming ornamental. Layout, typography,
spacing, motion, color, and component behavior MUST reinforce clarity, hierarchy,
and calm operator control. New UI work MUST reuse established patterns before
introducing new ones, and any new pattern MUST raise the overall bar for coherence.
Rationale: slick design is not decoration; it is the visible expression of product
quality, trustworthiness, and ease.

## Architecture Constraints

The following constraints remain mandatory for ACP-specific implementation:

- User intent MUST enter through Prime; secondary surfaces MAY expose promoted
  actions, but they MUST route through Prime rather than creating parallel control
  paths.
- Durable records in ACP's database MUST remain the source of truth for work,
  decisions, approvals, and artifacts; session state and transient UI state are
  never authoritative.
- Per-agent isolation remains mandatory through dedicated worktrees, working
  directories, scoped environments, short-lived credentials, and enforced runtime
  boundaries.
- ACP remains single-tenant and self-hosted by design; one instance serves one
  human operator unless this Constitution is amended.

## Delivery & Review Standards

Every spec, plan, task list, implementation, and review MUST prove alignment with
these principles.

- Specs MUST define the user-facing outcome, the simplest viable scope, the
  operational impact, and the intended UX behavior for normal and failure states.
- Plans MUST document why the proposed design is the simplest viable approach and
  MUST call out any new abstraction, dependency, or subsystem that cannot be
  avoided.
- Tasks MUST include work for verification, observability, UX states, and design
  consistency whenever those concerns are affected.
- Reviews MUST reject changes that add speculative architecture, weaken
  operability, lower UX consistency, or introduce visually inconsistent UI.
- Definition of done MUST include appropriate verification, updated operational
  signals where needed, and a user flow that is both understandable and polished.

## Governance

This Constitution supersedes conflicting guidance in specs, plans, tasks, and
runtime documentation. Any exception requires this document to be amended first.

Amendments MUST include:

1. explicit motivation describing what changed and why;
2. conflict callouts identifying affected specs, templates, or workflows; and
3. a migration plan for any in-flight or previously approved work made inconsistent
   by the amendment.

Versioning policy is Semantic Versioning for governance:

- **MAJOR**: removes or materially redefines a principle, or changes a mandatory
  governance contract in a backward-incompatible way;
- **MINOR**: adds a new principle, section, or materially expanded requirement; and
- **PATCH**: clarifies wording, improves examples, fixes typos, or makes other
  non-semantic refinements.

Compliance review expectations:

- Every plan MUST include a constitution check before research and after design.
- Reviewers MUST verify code quality, YAGNI discipline, SRE readiness, UX
  consistency, and visual coherence for the scope being changed.
- Template updates MUST stay aligned with this Constitution.
- Repository-specific Prime Agent constraints in `AGENTS.md` remain binding for
  Prime implementation work.

**Version**: 1.0.0 | **Ratified**: 2026-05-21 | **Last Amended**: 2026-05-23
