# Feature Specification: PrimeLoop Repo Rename Plan

**Feature Branch**: `[023-repo-rename-plan]`

**Created**: 2026-06-03

**Status**: Draft

**Input**: User description: "Use speckit-specify to come up with a repo rename plan" with confirmed project/product name "PrimeLoop"

## Clarifications

### Session 2026-06-03

- Q: Should the rename use an immediate hard cutover for all identifiers, or a staged migration that preserves old operational identifiers temporarily? → A: Rename branding and repo-facing names now, but keep operational identifiers temporarily with a staged migration plan.
- Q: What should be the single canonical public-facing name during and after the rename? → A: PrimeLoop is the canonical user-facing product, repository, and documentation name; Prime remains only an internal agent/runtime concept.
- Q: Should historical completed specs and archival records be rewritten to the new brand, or preserved for traceability? → A: Preserve historical and archival records as written, but update active docs and current-facing references to PrimeLoop.
- Q: How far should this rename plan go for third-party systems and external surfaces? → A: Plan the repository rename in detail and list third-party or external follow-ups as manual actions only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Identify every public rename surface (Priority: P1)

As the operator, I want a complete inventory of every repository surface that still uses the old name so I can rename the project to PrimeLoop without missing user-facing or operational references, while keeping Prime as an internal coordinator concept rather than a competing public brand and handling third-party follow-ups as explicit manual actions.

**Why this priority**: A rename fails if visible names, repo metadata, images, scripts, and docs drift. A complete inventory is the minimum safe starting point.

**Independent Test**: Review the produced rename inventory and confirm it covers repository identity, runtime configuration, docs, packaging, deployment references, and in-product text without relying on source spelunking.

**Acceptance Scenarios**:

1. **Given** the repository still contains references to the old name, **When** the rename plan is prepared, **Then** it lists each affected surface grouped by category and file or system location.
2. **Given** a surface has external impact beyond the repo, **When** it is included in the plan, **Then** the plan marks it as requiring coordinated operator action.

---

### User Story 2 - Sequence the rename safely (Priority: P1)

As the operator, I want the rename work broken into safe phases so I can update the repository, package metadata, deployment references, and product copy in a controlled order.

**Why this priority**: The rename touches multiple layers. A phased plan reduces breakage and makes rollback and verification practical.

**Independent Test**: Follow the plan phase-by-phase and confirm each phase has a clear objective, bounded scope, dependencies, and completion signal.

**Acceptance Scenarios**:

1. **Given** the rename spans repository, build, runtime, and product surfaces, **When** the plan is generated, **Then** it organizes the work into ordered phases with dependencies and scope boundaries.
2. **Given** a phase can be completed without finishing the whole rename, **When** the plan describes that phase, **Then** it states what can be verified independently before moving on.

---

### User Story 3 - Preserve operator continuity during the rename (Priority: P2)

As the operator, I want the rename plan to call out compatibility, migration, and communication risks so local development, deployment automation, and existing docs do not silently break.

**Why this priority**: Renames create subtle breakage in paths, container images, environment variables, and scripts. Explicit migration guidance lowers operational risk.

**Independent Test**: Review the plan and confirm every renamed surface that may break existing workflows has a mitigation, compatibility approach, or manual follow-up note.

**Acceptance Scenarios**:

1. **Given** existing automation or local workflow depends on the old repo name, **When** the plan covers that surface, **Then** it describes the expected impact and mitigation.
2. **Given** some references cannot be changed atomically, **When** the plan is prepared, **Then** it identifies temporary compatibility or transition steps.

---

### Edge Cases

- Historical completed specs, archived notes, and immutable external records may retain legacy naming for traceability, but the plan must distinguish them from active docs and current-facing references that should be updated to PrimeLoop.
- How should the rename proceed when internal code identifiers and external user-facing labels should change on different timelines?
- Scripts, environment variables, and image names may remain on legacy operational identifiers temporarily during the first rename phase, provided the plan defines their later migration and the operator impact of keeping them.
- What happens when third-party systems, bookmarks, or operator habits still rely on the old repository slug or working-directory path?

## Constitution Alignment *(mandatory)*

- **Code Quality Plan**: The rename plan will prefer a complete inventory and deterministic sequencing over ad hoc string replacement so changes remain reviewable, bounded, and easy to verify.
- **YAGNI Check**: No new subsystem is required. The plan is limited to naming, migration, compatibility, and verification work necessary to move from Agent Control Plane to PrimeLoop.
- **Reliability & Operations**: The plan will explicitly cover scripts, image names, environment variables, deployment references, local paths, and rollback-sensitive surfaces so the rename does not silently break operator workflows.
- **UX Consistency**: The plan will define where PrimeLoop replaces the old product name in repo metadata, docs, and product copy, and will call out any places where the old name may temporarily remain for compatibility.
- **Design Consistency**: The rename will preserve existing product terminology patterns and only change brand/name references that materially affect consistency.
- **ACP Architecture Constraints**: No architectural change. Prime remains the steering interface and durable records remain authoritative; this feature only changes naming and migration surfaces.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system documentation for this feature MUST define PrimeLoop as the new project and product name replacing Agent Control Plane where the repository currently presents the old brand.
- **FR-001a**: The rename plan MUST treat PrimeLoop as the single canonical public-facing name across repository identity, product copy, and documentation, and MUST avoid using Prime as an alternate public brand.
- **FR-002**: The rename plan MUST produce a categorized inventory of rename surfaces, including repository metadata, package metadata, deployment artifacts, automation scripts, documentation, and user-facing product copy.
- **FR-003**: The rename plan MUST distinguish between in-repository changes and operator-coordinated external changes.
- **FR-003a**: The rename plan MUST provide detailed sequencing for repository-controlled surfaces and summarize third-party systems, registries, bookmarks, and other external follow-ups as manual operator actions rather than full in-scope execution steps.
- **FR-004**: The rename plan MUST sequence the work into ordered phases with clear scope boundaries and dependencies.
- **FR-005**: The rename plan MUST identify any high-risk surfaces where renaming may break local development, deployment, packaging, or runtime behavior.
- **FR-006**: The rename plan MUST specify verification expectations for each phase so the operator can confirm the rename remains coherent before proceeding.
- **FR-007**: The rename plan MUST call out any surfaces where temporary compatibility, aliasing, or staged migration is preferable to an immediate hard cutover.
- **FR-007a**: The rename plan MUST treat user-facing branding, repository-facing naming, and operator-visible documentation as first-phase rename targets, while allowing package identifiers, image names, environment variables, and similar operational identifiers to remain temporarily on legacy values during a staged migration.
- **FR-008**: The rename plan MUST identify which historical or immutable records should be preserved as-is rather than rewritten.
- **FR-008a**: The rename plan MUST distinguish completed historical specs, archived notes, and immutable external records from active docs and current-facing references, and MUST update only the latter to PrimeLoop unless a traceability risk is explicitly waived.
- **FR-009**: The rename plan MUST define the target naming style for key surfaces, including repository name, package names, image names, product title, and shorthand references where applicable.
- **FR-009a**: The rename plan MUST explicitly distinguish public brand naming from internal runtime terminology so Prime continues to refer only to the coordinator role or agent concept where needed.
- **FR-010**: The rename plan MUST keep the scope bounded to naming and migration work required for the PrimeLoop rebrand, without introducing unrelated refactors.

### Key Entities *(include if feature involves data)*

- **Rename Surface**: Any file, setting, artifact, identifier, or user-visible label that currently references the old project or product name and may need update, migration handling, or explicit preservation.
- **Rename Phase**: An ordered unit of rename work with a defined objective, dependency boundary, verification step, and completion signal.
- **Compatibility Surface**: A rename surface where operator workflows, automation, or external integrations may continue depending on the old name during transition.
- **Naming Target**: The approved PrimeLoop naming convention for a specific surface such as repo slug, package name, image path, UI label, or documentation heading.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The plan inventories all currently known rename surfaces found in the repository and groups them into clear categories with no uncategorized high-impact references.
- **SC-002**: The plan defines a phased rename sequence that an operator can execute without needing to infer missing ordering or dependencies.
- **SC-003**: Every phase includes a clear completion check so the operator can determine whether the rename is safe to continue.
- **SC-004**: The plan explicitly identifies all known external or manual follow-up actions required beyond repository file edits.
- **SC-004b**: Repository-controlled rename work is described in enough detail to execute directly, while third-party follow-ups are captured in a separate manual-action list without expanding the plan into external runbooks.
- **SC-004a**: The plan clearly separates preserved historical references from active references that must be updated, so an operator can audit rename completion without mistaking archival content for missed work.
- **SC-005**: The plan distinguishes permanent renames from compatibility-preserved or historical references so operator expectations remain clear.
- **SC-006**: The first phase of the plan clearly separates immediate PrimeLoop branding changes from legacy operational identifiers that remain temporarily in place, with each deferred identifier assigned a later migration step or explicit preservation rationale.

## Assumptions

- PrimeLoop is the approved canonical project and product name for future repository-facing and user-facing branding.
- Prime remains an internal coordinator concept and is not a parallel public product name.
- Prime remains the central coordinating agent concept; this feature does not redefine runtime architecture or orchestration behavior.
- Historical completed specs and archival records should retain legacy naming where rewriting them would reduce traceability, while active docs and current-facing references should move to PrimeLoop.
- User-facing branding and repository-facing naming should change to PrimeLoop first, while some operational identifiers may need staged migration rather than instant replacement if external systems depend on the current values.
- The immediate outcome of this feature is a rename plan, not the execution of the full rename itself.
- Third-party systems and external surfaces are tracked as manual follow-up actions, not full in-scope execution playbooks for this feature.
