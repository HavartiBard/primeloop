# Implementation Plan: Agent Catalog

**Branch**: `026-agent-catalog` | **Date**: 2026-06-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/026-agent-catalog/spec.md`

## Summary

Introduce a reviewed, versioned **Agent Catalog**: declarative YAML templates that carry the *complete, modular* agent definition (system prompt, soul, persona, capability profile, runtime requirements, MCP/tool access, credential needs, approval policy, provenance, version, lifecycle intent). YAML files are the durable, shareable authoring/intent layer (local directory by default; optional Git repo for publication). PrimeLoop's database is the runtime source of truth: it records admission state and an **immutable snapshot of each registered version**, maps registered templates onto existing PrimeLoop concepts (capability profiles, tool grants, MCP assignments, brokered credentials), and on explicit instantiation creates a managed agent that the existing on-demand RuntimeLease system boots only when work arrives.

Technical approach: add a `catalog/` backend module (source readers, structural+semantic validator, admission state machine, registrar/mapper, instantiator, migrator) plus four new DB tables and one provenance column; expose a `/api/catalog` router and a Prime control-plane skill/tool for curation; add a Catalog admin surface in `web/` reusing approval-queue patterns. Configuration is moved out of code by generating a built-in **seed catalog** from today's in-code definitions (`ephemeral-templates.ts`, `durable-staff.ts`) and repointing the spawn/bootstrap paths to read the catalog.

## Technical Context

**Language/Version**: TypeScript (Node.js, ESM, `.js` import specifiers) — matches `backend/`.

**Primary Dependencies**: Express 4, `pg` 8 (PostgreSQL), Vitest 2. **New**: `yaml` (parse/stringify catalog files). Git access via `child_process` calling the system `git` (no new dependency). Structural validation hand-rolled (no `zod`/`ajv`, matching existing route-validation style).

**Storage**: PostgreSQL (schema in `backend/src/db.ts`, idempotent `CREATE TABLE IF NOT EXISTS`). Catalog *files* on the local filesystem (default) or a Git working tree.

**Testing**: Vitest. Unit tests for validator/mapper/state-machine (no DB); DB-backed integration tests gated on `TEST_DATABASE_URL` (existing pattern, e.g. `tests/registry.test.ts`).

**Target Platform**: Self-hosted Linux server (single-tenant).

**Project Type**: Web application — `backend/` (Express API + services) and `web/` (React SPA served as static `public/`).

**Performance Goals**: Operator-scale, not high-throughput. Sync/validate a catalog of ≤ ~100 templates in a few seconds; admission and instantiation are interactive (sub-second DB operations).

**Constraints**: Catalog is intent only — never authoritative runtime state. Declarations may only *narrow*, never widen, runtime authority (effective grant = intersection of declaration ∩ runtime policy). No secret values in catalog files. No eager runtime boot on instantiation. Running managed agents are never mutated by catalog operations.

**Scale/Scope**: One operator, tens of templates, a handful of catalog sources (typically one local dir + optionally one Git repo).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code quality**: New logic is isolated in a cohesive `catalog/` module with clear seams (source → validate → admit → register → instantiate). Failure modes are explicit, named codes (not booleans). Verification proportional to risk: validator and least-privilege mapping get focused unit tests; admission/rollback/instantiation get DB-backed integration tests. **PASS**.
- **YAGNI**: Only one new runtime dependency (`yaml`) — justified because the chosen catalog format is YAML. Git access reuses `child_process` + system `git`; validation is hand-rolled to match existing patterns rather than pulling `zod`/`ajv`. No new service, no parallel runtime authority — the catalog maps onto existing tables and the existing approval queue, lease manager, and credential broker. New tables (4) + one column are the minimum needed to satisfy "reviewed and versioned" with immutable provenance. **PASS**.
- **SRE readiness**: Every admission transition is appended to `catalog_admission_events` (append-only, actor + reason). Sync returns per-entry outcomes; partial failures never abort the batch silently. Rollback restores a prior registered snapshot without losing history. Catalog operations never touch running agents, so a bad template cannot destabilize in-flight work. Structured logs on sync/validate/instantiate; failure reasons are operator-readable. **PASS**.
- **UX consistency**: The Catalog admin surface reuses the settings/admin panel (021) shell and the approval-queue (008) review pattern. One predictable primary flow: review → approve → register → instantiate, with explicit loading/empty/error/success states and consistent admission-state terminology. **PASS**.
- **Visual polish**: Reuses existing settings panels, tables, status badges, and approval components; no new visual paradigm. Admission states render as existing status-badge tokens. **PASS**.
- **Primeloop architecture constraints**: Operator intent still flows through Prime and the existing approval surface; the DB remains source of truth; the catalog (Git/local) is intent only. Per-agent isolation, scoped runtime bounds, and the single-tenant assumption are preserved (sharing is of *definitions*, not a multi-tenant runtime). **PASS**.
- **Decoupled, replaceable runtime**: Instantiation creates a managed-agent *record* only; the existing on-demand RuntimeLeaseManager (specs 024/025) provisions and reclaims the process — no eager boot, no hand-tended pet. Brains stay model-agnostic; the catalog defines configuration, not runtime wiring. Recovery/health stay owned by PrimeLoop. **PASS**.
- **Runtime containment**: The catalog cannot widen authority — `runtime_requirements` (filesystem scope, egress allowlist, limits) and least-privilege grant intersection are enforced at registration/instantiation; declared credential needs resolve only through the brokered short-lived `CredentialBroker`, never inlined. Auto-approval is honored only within a defined safe baseline. **PASS**.
- **Complexity tracking**: No unjustified violations. The single new dependency and new tables are recorded in Complexity Tracking below as deliberate, justified additions.

**Initial gate: PASS.** Re-evaluated after Phase 1 design (see end of file): **PASS**.

## Project Structure

### Documentation (this feature)

```text
specs/026-agent-catalog/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (REST + catalog file schema + control-plane tool)
│   ├── catalog-api.md
│   ├── template-schema.md
│   └── orchestrator-skill.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── catalog/                  # NEW — the catalog module
│   │   ├── types.ts              # CatalogTemplate, AdmissionState, FailureCode, etc.
│   │   ├── schema.ts             # required/optional field definitions + structural parse
│   │   ├── validator.ts          # structural + semantic validation → named failure codes
│   │   ├── source.ts             # read templates from local dir or git (ref→SHA resolve)
│   │   ├── store.ts              # DB access for catalog_* tables (CRUD + snapshots)
│   │   ├── admission.ts          # state machine + batch sync orchestration + events
│   │   ├── registrar.ts          # map registered version → capability_profile + blueprint
│   │   ├── instantiate.ts        # registered version → managed agent (no eager boot)
│   │   ├── migrate.ts            # generate draft templates from in-code defs (seed catalog)
│   │   └── baseline.ts           # safe-baseline definition for auto-approval
│   ├── routes/
│   │   └── catalog.ts            # NEW — createCatalogRouter({ pool })
│   ├── db.ts                     # EDIT — add catalog_* tables + agents provenance column
│   ├── app.ts                    # EDIT — register /api/catalog router
│   ├── ephemeral-templates.ts    # EDIT — spawn reads catalog (fallback to in-code seed)
│   ├── durable-staff.ts          # EDIT — bootstrap seeds from catalog
│   └── mcp/service.ts            # EDIT — add catalog control-plane tools (curate/instantiate)
├── tests/
│   └── catalog/                  # NEW — validator/admission/mapper/instantiate/migrate tests
└── catalog/                      # NEW (gitignored runtime dir) — default LOCAL catalog store
    └── *.yaml                    # seed + operator templates (built-in seed generated by migrate)

web/
└── src/
    └── (settings/admin)          # NEW — Catalog admin view (list, review/approve, sync,
                                  #        instantiate, rollback) reusing approval-queue patterns

prompts/agents/                   # SOURCE for migration — persona/soul content lifted into templates
```

**Structure Decision**: Web application layout (existing `backend/` + `web/`). All new backend logic is contained in `backend/src/catalog/` with a thin `routes/catalog.ts` and minimal edits to three existing integration points (`db.ts`, `app.ts`, the two spawn/seed paths) plus catalog control-plane tools in `mcp/service.ts`. The default local catalog store is a gitignored `backend/catalog/` directory; pointing at a Git repo is an optional source configuration.

## Complexity Tracking

> Deliberate additions, justified against YAGNI (no unjustified constitutional violations).

| Addition | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|--------------------------------------|
| New dependency `yaml` | The catalog format is YAML (operator-authored, diff-reviewed, Git-publishable) | Hand-parsing YAML is error-prone and unsafe; JSON-only would hurt the human-authoring/review UX the feature exists to provide |
| 4 new tables + 1 column (`catalog_sources`, `catalog_templates`, `catalog_template_versions`, `catalog_admission_events`, `agents.catalog_template_version_id`) | "Reviewed and versioned" requires durable admission state, immutable per-version snapshots, an append-only transition log, and provenance linkage from running agents | Storing only files (no DB) fails immutability/rollback/audit and breaks in local-only mode (no SHA anchor); folding state onto existing tables would overload `agents`/`capability_profiles` and lose the version snapshot |
| Git access via `child_process` (not a library) | Resolve ref→SHA and read files at a commit for provenance | Adding `simple-git`/`nodegit` is unjustified weight; the system `git` is already present and the operations are trivial |
