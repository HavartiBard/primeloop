# Phase 0 Research: PrimeLoop Repo Rename Plan

## Decision 1 — Use `PrimeLoop` as the sole public-facing brand

**Decision**: Treat `PrimeLoop` as the canonical public-facing product, repository, and
documentation name. Keep `Prime` only as an internal coordinator/runtime concept.

**Rationale**: The spec clarification explicitly chose a single public name to avoid product
ambiguity. A repo rename only succeeds if visible branding converges on one term across README,
package metadata, UI text, and active docs.

**Alternatives considered**:
- Use `Prime` in some UI or docs while `PrimeLoop` names the repo — rejected because it creates a
  second public brand.
- Use `Prime Agent Loop` as the formal name — rejected because it is longer and less aligned with
  the approved branding.

## Decision 2 — Use staged migration instead of a hard cutover

**Decision**: Split the rename into two classes of identifiers:
1. immediate rename targets: user-facing branding, repository-facing naming, and active docs
2. deferred compatibility targets: package names, image names, Docker network names, script text,
   and similar operational identifiers that may still be referenced by existing workflows

**Rationale**: The repository already contains operationally sensitive machine names such as
`agent-control-plane-backend`, `agent-control-plane_default`, and image references in shell and
Docker assets. Renaming those in the same step as branding increases the chance of breaking local
or deployment workflows.

**Alternatives considered**:
- Hard-cut every identifier in one pass — rejected due to higher rollback and operator-risk cost.
- Delay all renaming to a later feature — rejected because ACP/Agent Control Plane naming confusion
  already affects the active product story.

## Decision 3 — Preserve historical records; update active references

**Decision**: Preserve completed historical specs, archived notes, and immutable references with
legacy naming, but update active docs and current-facing references to PrimeLoop.

**Rationale**: Historical Speckit artifacts encode real delivery history and should remain auditable.
The rename plan should make archival preservation explicit so preserved legacy references are not
misread as missed rename work.

**Alternatives considered**:
- Rewrite all historical specs for consistency — rejected because it weakens traceability.
- Leave all docs untouched and rename only code/package surfaces — rejected because the product
  rename would remain unclear to operators.

## Decision 4 — Scope repository changes deeply, external systems shallowly

**Decision**: Provide detailed execution guidance for repository-controlled surfaces and capture
third-party systems, bookmarks, registries, and other external dependencies as a manual follow-up
list only.

**Rationale**: The repository can be audited and changed deterministically; third-party systems vary
by operator environment. Listing them as follow-ups keeps the plan bounded while still surfacing the
work.

**Alternatives considered**:
- Write full third-party runbooks — rejected because this feature is a repo rename plan, not an
  environment-specific operations guide.
- Ignore third-party follow-ups — rejected because it would hide real rename completion work.

## Decision 5 — Adopt `primeloop` as the machine-readable slug family

**Decision**: Use the following naming convention in the plan:
- Public brand/title case: `PrimeLoop`
- Repo/package/image slug family: `primeloop`
- Kebab-case multi-part machine names: `primeloop-backend`, `primeloop-web`, etc.
- Preserve `prime` references only where they refer to the internal coordinator role or existing
  runtime concepts such as the Prime event loop

**Rationale**: A single lowercase slug family is shorter, easier to search, and avoids carrying the
old multi-word control-plane label into future machine identifiers. It also distinguishes clearly
between public brand naming and internal Prime terminology.

**Alternatives considered**:
- `prime-loop` as the repo slug — rejected because it is less aligned with the approved one-word
  brand.
- Keep `agent-control-plane-*` packages indefinitely — rejected because it prolongs the brand split.
- Rename internal `Prime*` runtime symbols to `PrimeLoop*` — rejected because the spec chose Prime
  as an internal concept, not a public brand conflict.

## Decision 6 — Start from observed repository rename surfaces

**Decision**: Seed the execution plan from the rename surfaces already visible in repository search
results, including:
- root `README.md` title and references
- `AGENTS.md` repo/product wording
- root/backend/web package names and related lockfiles
- `docker-compose.prod.yml` image name
- `scripts/dev-up.sh` repo validation text and container/network assumptions
- backend runtime strings such as ACP client/server names
- frontend product copy such as `web/index.html`, `web/src/pages/Setup.tsx`, and sidebar labels

**Rationale**: The existing repository already exposes a concrete first-pass inventory, which makes
Phase 1 design specific and auditable rather than hypothetical.

**Alternatives considered**:
- Plan rename categories abstractly without enumerating concrete surfaces — rejected because it
  would leave too much discovery work for later phases.
