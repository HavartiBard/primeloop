# Implementation Plan: Runtime Packaging and Growth Boundaries

**Branch**: `027-runtime-packaging-and-growth-boundaries` | **Date**: 2026-06-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/027-runtime-packaging-and-growth-boundaries/spec.md`

## Summary

Define PrimeLoop's install, recovery, and self-improvement model around an immutable application payload and durable external state. Make the **prebuilt container image** the clearly documented default install path while preserving a **source/local** path for advanced users. Audit the codebase for mutable versus immutable surfaces, classify those surfaces into policy classes, and move any behavior-changing mutable state out of app-local ephemeral paths into durable extension stores or managed workspaces.

This work is primarily architectural and operational rather than algorithmically complex. The implementation centers on documentation, deployment assets, path/storage refactors, policy enforcement, and release-flow correctness.

## Technical Context

**Language/Version**: TypeScript (backend/web), shell/YAML for deployment assets

**Primary Dependencies**: Existing Docker Compose deployment, Express backend, React web app, PostgreSQL, existing catalog/prompt/workspace/runtime modules

**Storage**: PostgreSQL, mounted workspace volumes, durable extension directories

**Testing**: Focused integration/verification around deployment config, restart recovery, workspace persistence, and policy enforcement for mutable versus immutable surfaces

**Target Platform**: Self-hosted Linux via Docker Compose as the recommended operator path; source/local mode supported for contributors and advanced users

**Project Type**: Web application with agent runtime/deployment infrastructure

**Constraints**:

- Do not treat the app container writable layer as durable state
- Do not widen agent self-modification authority into core security or control-plane code
- Keep install docs clear about first-class versus secondary paths
- Preserve existing runtime truth in the database and managed workspaces

## Constitution Check

*GATE: Must pass before implementation work begins.*

- **Code quality**: The feature turns implicit operational assumptions into explicit rules and reduces ambiguity about where mutable behavior belongs. Any path/storage refactors should be narrow and policy-driven. **PASS**.
- **YAGNI**: We are not building a universal package manager or plugin framework here. The feature only formalizes install modes, persistence boundaries, and extension governance already implied by the repo. **PASS**.
- **SRE readiness**: This is primarily an SRE/readiness feature. Recovery from container replacement and image upgrades becomes explicit and testable. Release-flow correctness for the prebuilt image becomes mandatory. **PASS**.
- **UX consistency**: The recommended install path is surfaced first; advanced paths are documented separately. Extension and approval surfaces should reuse existing catalog/settings patterns. **PASS**.
- **Primeloop architecture constraints**: Runtime truth stays in the DB and managed workspaces; packaging remains replaceable; extension surfaces cannot override isolation, approval, or credential policy. **PASS**.

## Project Structure

### Documentation (this feature)

```text
specs/027-runtime-packaging-and-growth-boundaries/
├── plan.md
└── spec.md
```

### Expected Source Touchpoints

```text
README.md                          # install-mode docs and persistence boundaries
docker-compose.yml                 # local/build-oriented path
docker-compose.prod.yml            # recommended prebuilt-image path
.gitea/workflows/build-image.yml   # release correctness for published image

backend/
├── src/
│   ├── workspace.ts               # durable workspace/profile storage boundaries
│   ├── routes/prime-profile.ts    # profile storage location governance
│   ├── catalog/                   # template/config extension surface
│   ├── opencode/process-manager.ts# workspace payload generation and repo/worktree separation
│   ├── launcher/                  # immutable-core runtime isolation boundary
│   ├── credentials/               # immutable-core secret/broker boundary
│   └── routes/ / runtime/ / db.ts # immutable-core authority surfaces to classify/document
└── prompts/                       # agent-extensible prompt surfaces, if retained as mutable

web/
└── src/pages/settings / catalog   # operator-facing documentation or policy visibility if surfaced in-product
```

## Surface Classification Draft

This classification is the core design artifact for the feature and should be validated against the actual codebase before implementation.

### `immutable-core`

- `backend/src/db.ts` and migration authority
- `backend/src/credentials/`
- `backend/src/launcher/`
- `backend/src/runtime/`
- approval enforcement and policy routing code
- security-critical MCP/runtime auth enforcement
- deployment/runtime isolation rules

Governance:

- Not agent-writable during normal operation
- Changed only through product engineering workflows or explicit high-trust escalation

### `agent-extensible`

- `backend/catalog/*.yaml`
- prompt/profile/skill artifacts intended as durable behavior modules
- approved future plugin/skill directories if added

Governance:

- Durable, reviewable, provenance-bearing
- Changeable by agents only through approved workflows

### `workspace-managed`

- mounted repos/worktrees under the configured workspace roots
- PrimeLoop's own repo when intentionally mounted as a managed repo for self-improvement

Governance:

- Treated as task work product, not installed product payload
- Must survive app container replacement independently of the app image

### `operator-managed`

- environment files
- deployment manifests
- install-time path configuration
- local override files not intended for agent mutation

Governance:

- Editable by operators/admin flows, not routine agent work

## Implementation Phases

### Phase 1: Audit and classify mutable surfaces

1. Inventory current behavior-changing file paths and storage locations.
2. Mark each as immutable-core, operator-managed, agent-extensible, or workspace-managed.
3. Identify any current violations where durable state is stored in app-local ephemeral locations.

### Phase 2: Normalize install and deployment story

1. Make the prebuilt-image path the clearly documented default.
2. Align deployment assets and docs to the actual published image path.
3. Keep the source/local path documented as advanced/contributor mode.
4. Make the image-publish CI path fail visibly if the recommended install path cannot be updated.

### Phase 3: Move mutable behavior into durable extension stores

1. Decide canonical durable locations for prompts, profiles, and other behavior-changing artifacts.
2. Refactor any app-local writes that currently blur installed payload versus durable extension state.
3. Ensure startup logic reads from durable extension stores where appropriate.

### Phase 4: Enforce self-improvement boundaries

1. Prevent routine agent mutation of immutable-core paths.
2. Route core-surface changes through explicit escalation.
3. Reuse approval/provenance flows for approved extension changes.

### Phase 5: Recovery and upgrade verification

1. Validate reinstall/upgrade with preserved database and workspace state.
2. Validate extension persistence across app replacement.
3. Validate PrimeLoop-self-improvement when PrimeLoop's repo is mounted as a managed workspace.

## Risks and Open Questions

- Some current prompt/profile writes may already be split between source-controlled files and generated workspace copies; the plan must decide which are authoritative and which are derived.
- A future plugin system may change where extension surfaces should live; this spec should define policy classes, not overfit to one directory layout.
- Windows support may remain container-first only; documentation should be explicit rather than vague.
- There may be tension between fast agent self-improvement and strong governance of core surfaces; the default should favor safety and recoverability.

## Deliverables

- Updated install/deployment docs that clearly separate recommended and advanced modes
- Corrected prebuilt-image publication and deployment references
- A documented surface-classification map for the repo
- Refactors for any mutable behavior currently stored in ephemeral app-local paths
- Policy/enforcement updates preventing routine agent mutation of immutable-core surfaces
