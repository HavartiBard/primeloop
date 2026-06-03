# Implementation Plan: PrimeLoop Repo Rename Plan

**Branch**: `023-repo-rename-plan` | **Date**: 2026-06-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/023-repo-rename-plan/spec.md`

## Summary

Rename the repository and product from **Agent Control Plane** to **PrimeLoop** using a staged migration.
The plan inventories every rename surface under repository control, applies **PrimeLoop** as the
sole public-facing name across repo identity, product copy, and active documentation, and keeps
**Prime** as an internal coordinator concept only. Repository-facing and user-facing branding moves
first; operational identifiers such as package names, image names, network names, and environment-
adjacent references may remain temporarily on legacy values when needed for operator continuity.
Historical specs and archival records are preserved for traceability, while third-party systems are
tracked as explicit manual follow-up actions rather than expanded into external runbooks.

## Technical Context

**Language/Version**: Markdown documentation plus an existing TypeScript/Node.js/React monorepo
whose rename surfaces appear in docs, package metadata, scripts, Docker assets, backend strings,
and frontend copy.

**Primary Dependencies**: Existing repository metadata (`README.md`, `AGENTS.md`), npm package
manifests/lockfiles, shell scripts, Docker Compose assets, backend TypeScript strings, frontend
React/Vite copy, and Speckit planning artifacts.

**Storage**: Files in the git repository only; no schema or durable data migration is part of this
feature.

**Testing**: Targeted repository search checks (`rg`), manual review of rename inventory, and
phase-by-phase verification captured in the plan/quickstart. No new automated test suite is
required for the planning artifact itself.

**Target Platform**: Self-hosted Linux development and deployment environment for this monorepo.

**Project Type**: Web application monorepo with `backend/`, `web/`, root scripts, Docker assets,
and planning/docs content.

**Performance Goals**: The rename plan should let an operator audit all repository-controlled rename
surfaces quickly, execute the staged rename without guesswork, and avoid unintended disruption to
existing development or deployment workflows.

**Constraints**:
- PrimeLoop is the single canonical public-facing name.
- Prime remains an internal runtime/coordinator term, not a parallel product brand.
- Repository-facing and user-facing branding changes land before legacy operational identifiers are
  retired.
- Historical completed specs and archival records remain unchanged unless traceability concerns are
  explicitly waived.
- Third-party systems and external services are documented as manual follow-ups, not detailed
  in-scope runbooks.
- No unrelated refactors or architectural changes are permitted.

**Scale/Scope**: Repository-controlled rename surfaces across root metadata, backend manifests,
frontend manifests, scripts, Docker/deployment references, active docs, and user-facing copy,
plus a bounded manual follow-up list for external systems.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code quality**: The feature produces a deterministic rename plan instead of ad hoc string
  replacement. Inventory categories, naming targets, phase boundaries, and verification checks keep
  execution reviewable and bounded.

- **YAGNI**: No new code subsystem, dependency, or configuration surface is introduced. The work is
  limited to planning the minimum rename/migration steps required to move branding from Agent
  Control Plane to PrimeLoop.

- **SRE readiness**: The plan explicitly addresses operationally sensitive identifiers such as
  package names, image names, Docker network names, scripts, and environment-adjacent references.
  Staged migration and rollback-aware sequencing reduce the risk of breaking local or deployed
  workflows.

- **UX consistency**: PrimeLoop becomes the single public name across active docs and user-facing
  product copy, while legacy operational identifiers may persist temporarily only where needed for
  continuity. The plan keeps terminology coherent and avoids mixing PrimeLoop and Prime as public
  brands.

- **Visual polish**: Existing UI patterns are preserved; the rename only changes brand text and
  naming surfaces. No new visual pattern is introduced.

- **ACP architecture constraints**: Prime remains the steering interface and internal coordinator
  concept. No change to durable records, tenant scope, or isolation model.

No constitutional violations. Complexity tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/023-repo-rename-plan/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── naming-contract.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created here)
```

### Source Code (repository root)

```text
.
├── AGENTS.md
├── README.md
├── package.json
├── package-lock.json
├── docker-compose.prod.yml
├── scripts/
│   └── dev-up.sh
├── backend/
│   ├── package.json
│   ├── package-lock.json
│   ├── src/
│   └── tests/
├── web/
│   ├── package.json
│   ├── package-lock.json
│   ├── index.html
│   ├── src/
│   └── tests/
└── specs/
    └── ...
```

**Structure Decision**: Web-application monorepo. The rename plan covers repository metadata,
documentation, scripts, package manifests, Docker/deployment references, backend strings, and
frontend copy. Historical specs remain primarily audit inputs rather than blanket rewrite targets.

## Phase 0: Research

1. Confirm canonical naming policy for public brand, machine identifiers, and internal Prime usage.
2. Inventory current rename surfaces already visible in the repository and group them by category:
   repo metadata, package metadata, deployment assets, scripts, backend runtime strings, frontend
   copy, active docs, and archival/history surfaces.
3. Decide which identifiers move in the first phase versus which remain temporarily on legacy
   values for compatibility.
4. Decide how to treat historical specs, archived notes, and third-party/manual follow-ups.

**Phase 0 Output**: `research.md`

## Phase 1: Design & Contracts

1. Model the rename domain with explicit entities for rename surfaces, phases, compatibility
   surfaces, naming targets, and external follow-ups.
2. Define the naming contract for canonical public brand usage, machine-readable slug conventions,
   staged legacy operational identifiers, and preserved historical references.
3. Write a practical quickstart showing how to apply and verify the staged rename in repository
   scope.
4. Update `AGENTS.md` so the active Speckit plan points to this feature plan.

**Phase 1 Output**: `data-model.md`, `contracts/naming-contract.md`, `quickstart.md`, updated
`AGENTS.md`

## Phase 2: Implementation Planning

1. Break execution into ordered rename phases:
   - Phase A: Repository-facing and user-facing PrimeLoop branding
   - Phase B: Active docs and product-copy cleanup
   - Phase C: Operational identifier migration (package/image/network/script surfaces)
   - Phase D: Manual external follow-ups only (operator-managed surfaces)
2. For each phase, define:
   - target surfaces
   - compatibility expectations
   - verification steps
   - rollback-sensitive notes
3. Capture exclusions explicitly:
   - historical/archive preservation
   - no unrelated refactors
   - no deep external runbooks

**Phase 2 Output**: `tasks.md` (already exists; generated by `/speckit.tasks` command)

## Phase A: Repository-Facing and User-Facing Branding

**Goal**: Establish PrimeLoop as the single public-facing name across repository identity, README, web product copy, and active docs.

**Included Surface Types / Concrete Examples**:
- Repository metadata: `README.md`, `AGENTS.md`
- Web product copy: `web/index.html`
- Frontend UI copy: `web/src/**/*.tsx`
- Active Speckit planning artifacts in `specs/023-repo-rename-plan/`

**Dependency Boundary**: Must complete before Phase B (active docs cleanup) and Phase C (operational identifiers). No dependencies on other phases.

**Compatibility Expectations**: Immediate rename; no staged migration allowed for public-facing branding. All changes are reversible via git history rollback.

**Verification/Completion Check**:
- `rg "Agent Control Plane|ACP" README.md web/index.html` returns only preserved historical references
- `rg "PrimeLoop" AGENTS.md` confirms updated naming
- Manual review of all UI copy in `web/src/**/*.tsx` shows no legacy references

**Rollback-Sensitive Notes**: Phase A changes are purely text replacements in Markdown/HTML/TSX files. Rollback is safe via `git checkout` to previous commit. No data or configuration impact expected.

## Phase B: Active Docs and Product-Copy Cleanup

**Goal**: Normalize active documentation to use PrimeLoop exclusively while preserving historical/archive references.

**Included Surface Types / Concrete Examples**:
- Active docs in `docs/` directory (excluding `docs/superpowers/plans/` which are preserved archival)
- Product copy in `web/` that describes current product behavior
- Speckit planning artifacts that describe current state

**Dependency Boundary**: Depends on Phase A completion. Must complete before Phase C (operational identifiers). Does not affect Phase D.

**Compatibility Expectations**: Preserve all completed historical specs in `specs/` and archival docs in `docs/superpowers/plans/`. Do not rename these. Only clean up active documentation that describes current product state.

**Verification/Completion Check**:
- `rg "ACP" docs/ --glob '!docs/superpowers/plans/*'` returns no hits or only intentional technical acronym uses unrelated to branding
- `docs/superpowers/plans/*.md` files retain legacy naming for historical accuracy
- Manual review confirms archival references are clearly labeled as preserved history

**Rollback-Sensitive Notes**: Phase B changes affect documentation text only. Rollback is safe via git checkout. Ensure no active docs reference ACP as current branding after rollback.

## Phase C: Operational Identifier Migration

**Goal**: Migrate machine identifiers (package names, image names, network names, script references) to PrimeLoop naming while allowing staged legacy migration for compatibility.

**Included Surface Types / Concrete Examples**:
- Package metadata and lockfiles: `package-lock.json`, `backend/package.json`, `backend/package-lock.json`, `web/package.json`, `web/package-lock.json` (the root `package.json` has no `name` field and is not itself a rename surface)
- Docker assets: `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.test.yml`, `docker-compose.prod.yml` (image tags, service names, environment variables, implicit network naming)
- Scripts: `scripts/dev-up.sh`
- Environment variables with legacy ACP naming: `ACP_DEV_DATABASE_*`, `ACP_BACKEND_URL`, `ACP_VM_IP`, `ACP_CORS_ORIGINS`, `ACP_MINIMAL_BOOT`, `ACP_STARTUP_TRACE`, `ACP_AGENT_WORKSPACE`
- Database names/users in compose URLs and settings: `agent_cp`, `agent_cp_dev`, `agent_cp_test`
- Volume/workspace paths: `/mnt/user/appdata/agent-cp/*`, `/mnt/user/appdata/agent-cp-dev/*`, `/var/lib/agent-cp/workspace`
- Backend runtime strings: `backend/src/db.ts`, `backend/src/workspace.ts`, `web/src/pages/Setup.tsx`, `web/src/pages/Governance.tsx` values that still embed legacy `agent-cp` paths or DB identifiers
- Script/container references: hardcoded container names such as `agent-control-plane-backend-dev-1`, `agent-cp-backend-1`
- Active root-level docs with legacy references: `SPEC-PLANNING.md`, `HANDOFF.md`

**Backend String Coverage Note**: Backend runtime and developer-facing legacy identifiers are covered in Phase C only where they materially encode legacy machine names (for example `agent_cp` database identifiers or `/var/lib/agent-cp/workspace` paths). Generic variable names such as `AGENT_REPO_ROOT` and `AGENT_WORKTREE_ROOT` are not branding surfaces and can remain unchanged unless Phase C execution identifies a compatibility reason to rename them.

**ACP Protocol Exclusion Note**: References to `ACP` meaning `Agent Client Protocol` are not rename targets for this feature. That includes technical protocol references under `backend/src/acp/`, `backend/src/fleet-executor/acp-harness.ts`, and similar implementation files where `ACP` is a protocol acronym rather than the public Agent Control Plane brand.

**Dependency Boundary**: Depends on Phase A and Phase B completion. Must complete before Phase D (external follow-ups). This phase handles repository-controlled operational identifiers.

**Compatibility Expectations**: Staged-legacy approach for high-risk identifiers. Use comments to explain why each identifier remains on legacy value. Ensure all changes are reversible with documented migration path.

**Verification/Completion Check**:
- `rg -n '"name"|agent-control-plane|agent-control-plane-web|agent-control-plane-backend' package-lock.json backend/package.json backend/package-lock.json web/package.json web/package-lock.json` confirms package identity updates or intentional staged-legacy entries
- `docker-compose -f docker-compose.prod.yml config` validates without network/image errors, and any implicit network naming assumptions are documented via project directory name or explicit `-p primeloop`
- Script execution test: `bash scripts/dev-up.sh --dry-run` shows no path errors

**Rollback-Sensitive Notes**: Phase C changes affect runtime behavior. Rollback requires:
1. Revert package.json changes first
2. Then revert Docker assets if image/network names changed
3. If manifest or lockfile identity changes prove incompatible, revert to previous lockfiles and package metadata
- Document rollback actions in new spec branch with timestamp and reason.

## Phase D: Manual External Follow-Ups

**Goal**: Track operator-managed external systems that require manual rename after completing Phase C.

**Included Surface Types / Concrete Examples**:
- Git remote repository rename (hosted platform)
- Container registry image tag updates
- CI/CD environment variables referencing legacy repo name
- Monitoring/alerting dashboard labels
- Documentation site URL structure
- Local clone remote URL updates
- Shell alias path updates

**Dependency Boundary**: Depends on Phase C completion. External systems cannot be renamed until all repository-controlled identifiers are migrated. Phase D has no code changes; it is purely operator checklist.

**Compatibility Expectations**: No code changes in this phase. All external systems must be updated manually by operators after Phase C verification passes. Do not assume external systems are automatically synced.

**Verification/Completion Check**:
- External follow-up checklist in quickstart.md has all items checked with operator initials and date
- No remaining `agent-control-plane` references in repository-controlled surfaces except preserved history or staged-legacy entries
- Repository search confirms all active references use PrimeLoop naming

**Rollback-Sensitive Notes**: Phase D involves external systems outside this repository. Rollback requires manual action by operators:
1. Revert Git remote rename (if done)
2. Revert container registry image tags
3. Update CI/CD environment variables back to legacy names
4. Update dashboard labels manually
- Document all rollback actions in external system logs with timestamp and reason.

## Canonical Naming Targets

| Surface Type | Target Format | Canonical Status | Notes |
|--------------|---------------|------------------|-------|
| Public product name | `PrimeLoop` | public-canonical | Required for active docs, repo identity, and user-facing product copy |
| Internal coordinator concept | `Prime` | internal-only | Allowed only for internal runtime/agent concepts, not as a parallel public brand |
| Repo slug family | `primeloop` | public-canonical | Preferred machine-readable slug for repo-level naming |
| Multi-part package/image names | `primeloop-*` | public-canonical | Preferred long-term machine identifier pattern (e.g., `primeloop-backend`, `primeloop-web`) |
| Historical/archive references | Preserve existing text | preserved | Allowed when needed for traceability; must not be mistaken for current branding |
| External third-party follow-ups | Manual action list | operator-managed | Must be tracked, but not expanded into full in-repo execution runbooks |

## Staged Migration Rule

Operational identifiers may remain temporarily on legacy values only if they have an explicit later migration phase or documented rationale.

This rule derives from spec FR-007a which states: "user-facing branding, repository-facing naming, and operator-visible documentation as first-phase rename targets, while allowing package identifiers, image names, environment variables, and similar operational identifiers to remain temporarily for compatibility."

**Deferred by default** (require later migration phase or explicit rationale):
- Package names (`agent-control-plane`, `agent-control-plane-backend`, `agent-control-plane-web`) → Phase C
- Docker image names (`code.klsll.com/havartibard/agent-control-plane:latest`) → Phase C
- Docker network names (implicit Compose network such as `agent-control-plane_default`, derived from the project directory name or explicit `-p` flag) → Phase C
- Script references (shell script text containing legacy names) → Phase C
- Environment variables referencing legacy names → Phase C

**Immediate rename targets** (no staged migration allowed):
- Public-facing branding in README.md, AGENTS.md, web/index.html → Phase A
- Active docs and product copy in docs/ → Phase B
- UI copy and labels in frontend → Phase A

**Preserved for traceability** (no migration required per FR-008a):
- Completed historical specs with legacy references → preserved-history
- Archived notes and immutable references → preserved-history

## Rename Surface Inventory (from repository search)

### Repository-Controlled Surfaces

| Category | Location | Current Value | Target Value | Phase | Ownership | Compatibility Mode | Risk Level | Verification Method |
|----------|----------|---------------|--------------|-------|-----------|-------------------|------------|--------------------|
| repo-metadata | README.md | `agent-control-plane` | `primeloop` | phase-a-brand | repo-controlled | immediate | low | Search for 'agent-control-plane' in README.md and confirm only preserved historical references remain |
| repo-metadata | AGENTS.md | `Agent Control Plane Instructions` | `PrimeLoop Instructions` | phase-a-brand | repo-controlled | immediate | low | Manual review |
| package-metadata | package-lock.json | `agent-control-plane` | `primeloop` | phase-c-operational | repo-controlled | staged-legacy | medium | Verify root lockfile package identity after Phase C rename |
| package-metadata | backend/package.json, backend/package-lock.json | `agent-control-plane-backend` | `primeloop-backend` | phase-c-operational | repo-controlled | staged-legacy | medium | Verify backend manifest and lockfile `name` fields after rename |
| package-metadata | web/package.json, web/package-lock.json | `agent-control-plane-web` | `primeloop-web` | phase-c-operational | repo-controlled | staged-legacy | medium | Verify web manifest and lockfile `name` fields after rename |
| deployment | docker-compose.prod.yml (registry image reference) | `code.klsll.com/havartibard/agent-control-plane:latest` | `code.klsll.com/havartibard/primeloop:latest` | phase-c-operational | repo-controlled | staged-legacy | high | Build Docker images and run `docker-compose -f docker-compose.prod.yml config` to validate syntax |
| deployment | docker-compose.dev.yml (local image reference) | `local/agent-cp-backend:current` | `local/primeloop-backend:current` | phase-c-operational | repo-controlled | staged-legacy | medium | Verify local dev image name updates alongside compose config |
| deployment | docker-compose.yml, docker-compose.dev.yml, docker-compose.test.yml, docker-compose.prod.yml (implicit default network derived from project directory name or explicit `-p` flag) | `agent-control-plane_default` | `primeloop_default` | phase-c-operational | repo-controlled | staged-legacy | medium | Confirm whether the project directory rename or explicit `docker compose -p primeloop` is the chosen migration path |
| script | scripts/dev-up.sh | `agent-control-plane` repo validation text, `agent-control-plane-backend-dev-1`, `agent-cp-backend-1` | `primeloop` repo validation text, `primeloop-*` container names or explicit preservation note | phase-c-operational | repo-controlled | staged-legacy | medium | Execute script in test environment and confirm no path or container cleanup errors |
| docs | docs/superpowers/plans/*.md | `ACP` references | preserved | preserved-history | repo-controlled | preserved | low | Manual review, confirm archival preservation per FR-008a |
| docs | SPEC-PLANNING.md | `ACP` references in active planning handoff content | `PrimeLoop` or preserved operational acronym notes | phase-b-docs | repo-controlled | immediate | low | Manual review of active planning text |
| docs | HANDOFF.md | `ACP_DEV_DATABASE_HOST` and related active handoff references | `PRIMELOOP_*` or explicit staged-legacy note | phase-c-operational | repo-controlled | staged-legacy | medium | Manual review of active handoff instructions |
| product-copy | web/index.html | `Agent Control Plane` | `PrimeLoop` | phase-a-brand | repo-controlled | immediate | low | Browser render test |
| ui-copy | `web/src/**/*.tsx` (including `web/src/components/Sidebar.tsx` and `web/src/pages/Setup.tsx`) | `Agent Control Plane`, `ACP` labels in current-facing UI | `PrimeLoop` | phase-a-brand | repo-controlled | immediate | low | Manual review of user-visible UI text |
| database | docker-compose.yml, docker-compose.dev.yml, docker-compose.test.yml, docker-compose.prod.yml, scripts/dev-up.sh, backend/src/db.ts | `agent_cp`, `agent_cp_dev`, `agent_cp_test` | `primeloop`, `primeloop_dev`, `primeloop_test` | phase-c-operational | repo-controlled | staged-legacy | high | Verify DB connection after rename and run migrations if needed |
| database-user | docker-compose.yml, docker-compose.dev.yml, docker-compose.test.yml, docker-compose.prod.yml, scripts/dev-up.sh | `agent_cp` | `primeloop` | phase-c-operational | repo-controlled | staged-legacy | medium | Update credentials and verify auth after rename |
| volume-path | docker-compose.prod.yml, docker-compose.dev.yml | `/mnt/user/appdata/agent-cp/postgres`, `/mnt/user/appdata/agent-cp/codex`, `/mnt/user/appdata/agent-cp/workspace`, `/mnt/user/appdata/agent-cp-dev/codex`, `/mnt/user/appdata/agent-cp-dev/workspace` | `/mnt/user/appdata/primeloop/...` and `/mnt/user/appdata/primeloop-dev/...` | phase-c-operational | repo-controlled | staged-legacy | high | Ensure volume paths are consistent and data is migrated if needed |
| workspace-path | backend/src/workspace.ts, web/src/pages/Setup.tsx, web/src/pages/Governance.tsx | `/var/lib/agent-cp/workspace` | `/var/lib/primeloop/workspace` | phase-c-operational | repo-controlled | staged-legacy | medium | Update all path references and verify workspace configuration flows |
| env-var | scripts/dev-up.sh, web/vite.config.ts, backend/src/app.ts, backend/src/index.ts, backend/src/workspace.ts | `ACP_DEV_DATABASE_*`, `ACP_BACKEND_URL`, `ACP_VM_IP`, `ACP_CORS_ORIGINS`, `ACP_MINIMAL_BOOT`, `ACP_STARTUP_TRACE`, `ACP_AGENT_WORKSPACE` | `PRIMELOOP_DATABASE_*`, `PRIMELOOP_BACKEND_URL`, `PRIMELOOP_VM_IP`, `PRIMELOOP_CORS_ORIGINS`, `PRIMELOOP_MINIMAL_BOOT`, `PRIMELOOP_STARTUP_TRACE`, `PRIMELOOP_AGENT_WORKSPACE` | phase-c-operational | repo-controlled | staged-legacy | high | Update environment variable names and verify runtime config |
| backend-string | backend/src/db.ts, backend/src/workspace.ts | `agent_cp` database identifiers, `/var/lib/agent-cp/workspace` | `primeloop` database identifiers, `/var/lib/primeloop/workspace` | phase-c-operational | repo-controlled | staged-legacy | medium | Update backend runtime strings and verify service startup/config migration notes |


### Preserved Historical/Archive References

| Category | Location | Reason for Preservation |
|----------|----------|------------------------|
| historical-spec | specs/002-agent-lifecycle-and-sandbox/spec.md | Completed spec with legacy ACP references; traceability preserved |
| historical-spec | specs/015-prime-routing-runtime-truth/spec.md | Completed spec with legacy ACP references; traceability preserved |
| historical-spec | specs/018-prime-onboarding-config/spec.md | Completed spec with legacy ACP references; traceability preserved |
| historical-spec | specs/022-acp-adapter/spec.md | Completed spec with legacy ACP references; traceability preserved |
| archival-doc | docs/superpowers/plans/*.md | Archived planning documents; preserved for historical accuracy |

**Preservation rationale**: Completed historical specs retain legacy naming for traceability per spec FR-008a. In practice, completed and archival records under `specs/` and `docs/superpowers/plans/` are preserved unless a specific traceability waiver is approved.

### Manual External Follow-Ups (Operator-Managed)

| System | Action | Evidence | Blocking |
|--------|--------|----------|----------|
| Git remote / hosted repo | Rename from `agent-control-plane` to `primeloop` | Repo renamed in hosting platform; verify by visiting repository URL | Yes |
| Container registry | Update image tags in all deployment manifests | New image tags pushed and manifests updated; verify by pulling new tag | Yes |
| Local clones | Operator update local remotes with `git remote set-url origin` | Operator confirms successful `git fetch` from new remote | No |
| Shell aliases | Operator update shell configs with new paths | Operator confirms scripts execute without path errors | No |
| CI/CD variables | Update environment variables referencing old repo name | Environment variable updated in CI system; verify by running a build | No |
| Dashboard labels | Update monitoring/alerting dashboard names | Dashboard shows PrimeLoop naming; verify by visual inspection | No |
| Documentation site | Update hosted docs URL structure | Docs site serves content at new URLs; verify by visiting key pages | No |

## Post-Design Constitution Check

- **Code quality**: Pass. The design stays documentation-first, deterministic, and bounded to
  rename/migration concerns.
- **YAGNI**: Pass. No speculative abstractions or new dependencies were introduced.
- **SRE readiness**: Pass. The design isolates operationally risky identifiers into a staged phase
  instead of forcing a brittle all-at-once cutover.
- **UX consistency**: Pass. PrimeLoop is the only public-facing name in active surfaces; Prime
  remains internal.
- **Visual polish**: Pass. Only terminology changes; no visual-system divergence.
- **ACP architecture constraints**: Pass. No architectural behavior changes.

## Rollback Guidance

If a phase fails verification, follow these steps:
1. **Phase A rollback**: Restore README.md and web/index.html from git history; no data impact expected
2. **Phase B rollback**: Restore only active docs changed in Phase B from git history; archival files in `docs/superpowers/plans/` remain preserved and are not modified
3. **Phase C rollback**: Revert package metadata changes first, then Docker assets; if manifest or lockfile identity checks fail, revert to previous lockfiles
4. **Phase D rollback**: No code changes possible; operator must manually revert external system changes

Document rollback actions in a new spec branch with timestamp and reason.

## Complexity Tracking

No constitutional violations to justify.
