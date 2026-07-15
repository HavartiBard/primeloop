# Feature Specification: Runtime Packaging and Growth Boundaries

**Feature Branch**: `027-runtime-packaging-and-growth-boundaries`

**Created**: 2026-06-17

**Status**: Draft

**Input**: User description: "We need a prebuilt image to help users get started, but we should decide whether PrimeLoop is OS-agnostic and which parts of the system are immutable versus modular hooks the agent loop can improve, evolve, and commit back to git."

## Overview

PrimeLoop currently has the right instincts but not yet a fully explicit operating model. The product needs a **prebuilt container install path** to reduce onboarding friction, but it also needs a **source/local install path** for advanced users and contributors. At the same time, PrimeLoop is an agentic system whose work can modify code, prompts, and templates over time. That means the container image cannot be treated as the durable source of truth for evolving behavior.

This feature defines PrimeLoop's packaging and mutation model around three principles:

1. **Packaging-agnostic, operationally opinionated**: PrimeLoop supports multiple install modes, but the prebuilt container path is the recommended and best-supported default.
2. **Disposable runtime, durable state**: Containers and local processes are replaceable. Durable state lives outside the image in the database, mounted workspaces, and explicit extension stores.
3. **Immutable core, extensible growth surfaces**: Agents may evolve allowed modular surfaces such as catalog templates, prompts, skills, and managed workspaces, but they must not silently rewrite PrimeLoop's control-plane core, security boundaries, or deployment substrate.

The result is a system that is easier to install, safer to operate, and more coherent about self-improvement. Rebuilding or replacing a container should reconnect to durable state and continue. Agent evolution should happen through explicit, durable artifacts with approval and provenance rather than hidden drift inside a live container filesystem.

## Clarifications

### Session 2026-06-17

- Q: Should PrimeLoop be OS-agnostic? → A: Yes at the packaging level, but not by making every path equally first-class. The recommended path is a prebuilt container install. Source/local installs remain supported for advanced users, development, and customization.
- Q: If the agent loop can self-improve and commit changes, where should that mutable state live? → A: Outside the container image. The image is immutable application packaging; mutable agent-produced changes live in mounted repos/workspaces, catalog/template stores, prompt/skill extension stores, and the database.
- Q: Can agents modify PrimeLoop itself? → A: Only through explicitly managed, durable repositories or extension surfaces. They must not mutate the live installed application container as an implicit persistence mechanism.
- Q: Do we need to classify which code is immutable versus modular? → A: Yes. This feature requires a repo-level classification of immutable control-plane core versus operator-managed or agent-extensible hook surfaces.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install PrimeLoop quickly through a prebuilt container path (Priority: P1)

An operator wants the fastest, lowest-friction way to get PrimeLoop running without building the app from source or understanding the repo layout.

**Why this priority**: This is the primary onboarding path. If the default install is high-friction, adoption suffers immediately.

**Independent Test**: Start PrimeLoop from the documented prebuilt-image deployment using only environment setup and Compose commands, without a local source checkout or local image build.

**Acceptance Scenarios**:

1. **Given** a new operator with Docker/Compose available, **When** they follow the recommended installation flow, **Then** PrimeLoop starts from a published prebuilt image without requiring `docker build`.
2. **Given** the prebuilt install path, **When** the operator reads the documentation, **Then** the recommended path is clearly presented as the default and best-supported install mode.
3. **Given** the prebuilt install path, **When** the operator upgrades to a newer version, **Then** the upgrade process replaces the application image without discarding durable database or workspace state.

---

### User Story 2 - Run PrimeLoop outside containers when needed (Priority: P2)

An advanced operator or contributor wants to run PrimeLoop from source on a local machine for development, customization, or debugging.

**Why this priority**: PrimeLoop should not become container-only, but this path is secondary to the default operator install.

**Independent Test**: Follow documented local/source setup on a supported developer machine, start the backend and web app, and confirm the same durable-state model applies.

**Acceptance Scenarios**:

1. **Given** a contributor machine with the required toolchain, **When** the operator chooses the source/local install mode, **Then** PrimeLoop can be run without the prebuilt image.
2. **Given** multiple install modes, **When** the documentation describes them, **Then** each mode's intended audience, support level, and tradeoffs are explicit.
3. **Given** a local/source install, **When** the process is restarted or rebuilt, **Then** durable state remains outside transient process state just as it does in the container path.

---

### User Story 3 - Recover from container loss without losing agent evolution (Priority: P1)

An operator loses or replaces the PrimeLoop application container after agents have created commits, updated templates, or evolved approved extension content.

**Why this priority**: This is the core operational risk in a self-improving system. Agent evolution is not credible if a container replacement erases it.

**Independent Test**: Run PrimeLoop, create durable changes in mounted repos and extension stores, replace the application container, and confirm the instance reconnects to those changes without manual reconstruction.

**Acceptance Scenarios**:

1. **Given** agents have created commits in managed repositories, **When** the application container is removed and recreated, **Then** the repos and commits remain intact and visible to the new container.
2. **Given** approved prompt/template/skill changes exist in durable extension storage, **When** the application image is upgraded, **Then** those changes remain available after restart.
3. **Given** the database and durable workspace volumes are preserved, **When** the application runtime is replaced, **Then** PrimeLoop resumes against the existing durable state rather than requiring catch-up from the image.

---

### User Story 4 - Evolve only approved modular surfaces, not the control-plane core (Priority: P1)

An agent or operator wants PrimeLoop to improve itself over time, but the system must constrain that evolution to approved, durable hook surfaces rather than unrestricted rewrites of its control-plane core.

**Why this priority**: Without a boundary between extensibility and core authority, self-improvement becomes operationally unsafe and undermines the system's security and recovery model.

**Independent Test**: Attempt changes through both approved extension surfaces and blocked immutable-core paths; confirm the system allows the former with provenance and approval, and rejects or escalates the latter.

**Acceptance Scenarios**:

1. **Given** an agent proposes a prompt, template, or skill update in an approved mutable surface, **When** the change is reviewed and accepted, **Then** it is stored durably with provenance and becomes active through the documented extension path.
2. **Given** an agent attempts to modify an immutable control-plane component, **When** policy evaluation runs, **Then** the change is blocked or routed for explicit operator escalation rather than silently applied.
3. **Given** the system documents mutable and immutable surfaces, **When** an operator inspects that policy, **Then** each major code/config area is clearly classified.

---

### User Story 5 - Distinguish installed product from managed workspaces (Priority: P2)

An operator uses PrimeLoop both as a product and as a managed coding system that may work on PrimeLoop's own repo or on other repos.

**Why this priority**: PrimeLoop needs a clean distinction between "the installed app" and "repos the app manages," especially when one of those repos may be PrimeLoop itself.

**Independent Test**: Run PrimeLoop with a managed repo mounted as a workspace, have agents edit that repo, and confirm those edits are treated as workspace changes rather than in-place mutations of the installed application payload.

**Acceptance Scenarios**:

1. **Given** PrimeLoop's own repo is mounted as a managed workspace, **When** an agent edits it, **Then** those edits occur in the workspace/repo layer rather than the installed application image layer.
2. **Given** the installed app files are separate from managed workspaces, **When** PrimeLoop is redeployed, **Then** workspace changes survive independently of the application package.
3. **Given** an operator wants the system to self-improve, **When** they enable that workflow, **Then** the improvement path targets durable managed repos or extension stores, not the live container filesystem.

---

### Edge Cases

- **Stale prebuilt image**: The recommended install path points at a published image tag that has not been refreshed. The system must fail visibly in CI/release flow rather than silently reporting a successful release pipeline.
- **Mutable state trapped in container filesystem**: An implementation accidentally stores learned prompts or generated configuration inside the app container writable layer. This is invalid; the system must relocate such state to durable storage.
- **PrimeLoop self-modifies its own live install**: A runtime task edits files inside the installed app payload instead of a managed workspace checkout. This must be blocked or explicitly modeled as a repo/workspace operation.
- **Extension drift across versions**: A new app version expects extension data in a different shape. Extension stores must be versioned/migrated explicitly rather than silently ignored or overwritten.
- **Operator runs on unsupported host OS**: The docs must distinguish supported install modes by platform rather than implying identical support across all environments.
- **Extension surface widens into core authority**: A prompt/template/skill hook indirectly gains power to bypass approvals, broker rules, or runtime isolation. The control-plane policy must prevent extension surfaces from redefining core security or authority boundaries.
- **Container upgrade with active workspaces**: An image upgrade occurs while durable workspaces contain in-flight changes. The upgrade must preserve those workspaces and reconnect cleanly on restart.
- **Source install and container install diverge behaviorally**: Multiple install modes must preserve the same persistence and mutability rules even if packaging differs.

## Constitution Alignment *(mandatory)*

- **Code Quality Plan**: The feature produces an explicit classification of mutable versus immutable surfaces and turns ambiguous operational assumptions into documented, testable rules. Packaging, persistence, and extension behavior are defined once and reused across deployment docs, runtime logic, and approval policy.
- **YAGNI Check**: This feature does not require making every platform path equally deep. It explicitly chooses a recommended default install mode and only keeps secondary paths where they are justified. Extensibility is constrained to existing or clearly-needed modular surfaces rather than making the whole codebase agent-mutable.
- **Reliability & Operations**: Durable state is moved out of the image boundary by rule, not convention. Reinstall, upgrade, and recovery flows become predictable because containers/processes are disposable and durable state is explicit.
- **UX Consistency**: Installation docs present a clear recommended path first, with advanced paths separated and labeled. Self-improvement and extension flows reuse existing approval and provenance patterns rather than introducing hidden mutation channels.
- **Design Consistency**: Administrative surfaces for extensions, prompts, templates, and future plugins should follow the same catalog/settings patterns already present in the repo.
- **Primeloop Architecture Constraints**: PrimeLoop's database remains source of truth for runtime state. Agents may improve managed repos and approved extension stores, but must not bypass approval, credential, or isolation boundaries by mutating the control-plane core in place. Runtime packaging remains replaceable.

## Requirements *(mandatory)*

### Functional Requirements

#### Installation modes

- **FR-001**: The system MUST define at least two official installation modes: a **recommended prebuilt container mode** and a **supported source/local mode**.
- **FR-002**: The documentation MUST clearly mark one install mode as the default recommendation and MUST describe the intended audience and support expectations for each mode.
- **FR-003**: The recommended install mode MUST use a published prebuilt application image and MUST NOT require building the PrimeLoop app from source during initial setup.
- **FR-004**: The source/local install mode MUST remain possible for advanced users and contributors, using documented prerequisites and startup steps.

#### Packaging and persistence boundaries

- **FR-005**: The PrimeLoop application image/package MUST be treated as **immutable deployment payload**, not as the durable source of runtime or self-improvement state.
- **FR-006**: Durable operator and agent state MUST live outside the application image, at minimum across these classes: database state, managed repository/workspace state, and approved extension/configuration state.
- **FR-007**: Replacing, rebuilding, or upgrading the application container/process MUST preserve durable state when the documented persistence locations are retained.
- **FR-008**: No required runtime state for normal recovery MAY exist only in the ephemeral writable layer of the application container/process.

#### Mutable versus immutable surfaces

- **FR-009**: The system MUST classify major PrimeLoop surfaces into at least these policy classes: `immutable-core`, `operator-managed`, `agent-extensible`, and `workspace-managed`.
- **FR-010**: `immutable-core` surfaces MUST include the control-plane authority boundary: database schema/migration authority, approval enforcement, credential-broker enforcement, runtime isolation/launcher enforcement, and other security-critical routing or policy code defined in the implementation plan.
- **FR-011**: `agent-extensible` surfaces MUST be limited to modular, durable, reviewable artifacts such as agent catalog entries, prompt files, skill definitions, and similarly approved extension points defined by the implementation plan.
- **FR-012**: `workspace-managed` surfaces MUST cover repositories and worktrees that PrimeLoop manages as task workspaces, including cases where the managed repo is PrimeLoop's own source repository.
- **FR-013**: The system MUST document which existing directories/files belong to each policy class and how changes to each class are governed.

#### Self-improvement boundaries

- **FR-014**: Agents MAY create and modify artifacts only within approved `agent-extensible` or `workspace-managed` surfaces unless a higher-trust escalation path is explicitly invoked.
- **FR-015**: Agents MUST NOT silently mutate `immutable-core` surfaces as part of routine self-improvement or task execution.
- **FR-016**: If an agent proposes a change to an `immutable-core` surface, the system MUST route that change through explicit operator escalation or equivalent high-trust approval rather than auto-applying it.
- **FR-017**: Self-improvement that changes PrimeLoop behavior MUST occur through durable, reviewable artifacts with provenance, not transient in-memory or in-container drift.

#### PrimeLoop-as-product versus PrimeLoop-as-managed-repo

- **FR-018**: The system MUST distinguish the installed PrimeLoop application payload from any repository that PrimeLoop manages as workspace content.
- **FR-019**: If PrimeLoop's own repository is managed for self-improvement, it MUST be handled as a durable workspace/repo under normal workspace governance, not as an in-place mutation of the installed application package.
- **FR-020**: Reinstalling or upgrading the application package MUST NOT be the mechanism by which managed repo history or extension content is preserved.

#### Extension storage and provenance

- **FR-021**: Every approved extension surface that can change system behavior MUST have a durable storage location and a provenance model sufficient to understand who or what changed it and when.
- **FR-022**: Extension surfaces that influence runtime behavior MUST support explicit review/approval rules consistent with their risk level.
- **FR-023**: The implementation MUST define where mutable prompt, template, skill, and profile artifacts live in production so they survive container or process replacement.
- **FR-024**: If an extension surface has version or schema expectations, upgrades MUST use explicit migration or compatibility handling rather than silent overwrite.

#### Deployment and release flow

- **FR-025**: The release process for the recommended prebuilt-image path MUST fail visibly when a required image publish step does not occur.
- **FR-026**: The repository's deployment assets and documentation MUST reference the actual prebuilt-image install path consistently.
- **FR-027**: The implementation MUST define which published image tags are supported for installation and upgrade guidance.

#### Operational recovery

- **FR-028**: Recovery documentation MUST describe how to replace the application container/process while preserving database, workspace, and extension state.
- **FR-029**: The runtime startup path MUST be able to reconnect to preserved durable state after application replacement.
- **FR-030**: The system MUST identify any existing mutable data currently stored in app-local paths and either classify it as ephemeral or move it into a durable location.

### Key Entities *(include if feature involves data)*

- **Install Mode**: A documented packaging path for running PrimeLoop, such as prebuilt container or source/local. Includes target audience, prerequisites, support expectations, and upgrade path.
- **Application Payload**: The shipped PrimeLoop code/runtime package or image. Replaceable and immutable at runtime except during explicit upgrades.
- **Durable Runtime State**: State that must survive process/container replacement, including database records, managed repos/workspaces, and approved extension stores.
- **Surface Policy Class**: The governance classification for a code/configuration area: `immutable-core`, `operator-managed`, `agent-extensible`, or `workspace-managed`.
- **Extension Surface**: A durable, reviewable modular artifact that can evolve PrimeLoop behavior without mutating the immutable core, such as catalog templates, prompts, skills, or profiles.
- **Managed Workspace**: A repository or worktree that PrimeLoop owns or mounts for task execution. Durable and separate from the installed application payload.
- **Self-Improvement Artifact**: A prompt/template/skill/repo change created by agents or operators that alters future system behavior and therefore requires provenance and governance.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new operator can install PrimeLoop using the documented recommended path without building the app locally.
- **SC-002**: Replacing the application container/process while preserving the documented durable state locations does not erase managed repo history, approved extension artifacts, or runtime database state.
- **SC-003**: The repo has an explicit, reviewable classification of major surfaces into immutable core versus mutable/extensible areas, and that classification is reflected in documentation and enforcement points.
- **SC-004**: Agent-created behavior changes occur only through approved extension surfaces or managed workspaces in all tested self-improvement scenarios.
- **SC-005**: Attempted changes to immutable-core surfaces are blocked or escalated in accordance with policy rather than silently applied.
- **SC-006**: The prebuilt-image release pipeline fails visibly if image publication required for the recommended install path does not happen.
- **SC-007**: Operators can identify where prompt/template/skill/profile changes are stored durably and how they survive reinstall in under 10 minutes from the docs.

## Assumptions

- Docker/Compose remains the lowest-friction operator install path and should be treated as the default recommendation.
- PrimeLoop will continue supporting local/source execution for contributors and advanced operators.
- Existing catalog, prompt, workspace, and runtime modules provide enough structure to define extension surfaces without making the whole control plane dynamically mutable.
- Security-critical control-plane logic should remain code-reviewed product logic, not agent-rewritable configuration.
