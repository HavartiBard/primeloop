# Agent Catalog

The Agent Catalog is the reviewed, versioned registry of agent templates for PrimeLoop. It separates *what an agent is* (declared in a YAML file) from *whether that agent is alive* (owned by the runtime). Every running managed agent in PrimeLoop must trace its lineage back to a registered catalog version.

## Table of contents

1. [Architecture overview](#architecture-overview)
2. [Core concepts](#core-concepts)
3. [Template file format](#template-file-format)
4. [Admission state machine](#admission-state-machine)
5. [Sync sources](#sync-sources)
6. [Approval and least-privilege](#approval-and-least-privilege)
7. [Versioning and rollback](#versioning-and-rollback)
8. [Instantiation and runtime](#instantiation-and-runtime)
9. [Migrating from in-code definitions](#migrating-from-in-code-definitions)
10. [Prime orchestrator integration](#prime-orchestrator-integration)
11. [REST API reference](#rest-api-reference)
12. [Operational notes](#operational-notes)

---

## Architecture overview

```
                  ┌─────────────────────────────────┐
                  │   YAML files (authoring intent) │
                  │  backend/catalog/*.yaml          │
                  │  (or optional Git repo)          │
                  └───────────────┬─────────────────┘
                                  │  POST /api/catalog/sync
                                  ▼
                  ┌─────────────────────────────────┐
                  │      Catalog Module              │
                  │  source.ts  ──▶  validator.ts   │
                  │      │               │           │
                  │  admission.ts ◀──────┘           │
                  │      │                           │
                  │  store.ts  (catalog_* tables)    │
                  └───────────────┬─────────────────┘
                                  │
                  discovered → validated → pending_approval → registered
                                                               │
                                              POST /approve    │
                                                               ▼
                  ┌─────────────────────────────────┐
                  │  registrar.ts                    │
                  │  capability_profiles row         │
                  │  current_version_id pointer      │
                  └───────────────┬─────────────────┘
                                  │
                                  │  POST /instantiate  (or Prime tool)
                                  ▼
                  ┌─────────────────────────────────┐
                  │  instantiate.ts                  │
                  │  agents row (execution_mode=     │
                  │  managed, no process yet)        │
                  │  tool_grants (declaration ∩      │
                  │  runtime policy)                 │
                  └───────────────┬─────────────────┘
                                  │
                                  │  Work arrives → RuntimeLeaseManager
                                  ▼
                  ┌─────────────────────────────────┐
                  │  On-demand runtime process       │
                  │  (Launcher / OpenCode)           │
                  └─────────────────────────────────┘
```

**Files are intent; the database is truth.** YAML files are the durable authoring layer — readable, diffable, Git-publishable. The PrimeLoop database stores the admission state, an immutable frozen snapshot of every registered version, and the live runtime records (agents, tool grants, leases). Catalog operations never modify running agents.

### Module map

| File | Responsibility |
|------|---------------|
| `backend/src/catalog/types.ts` | Shared types: `AdmissionState`, `FailureCode`, `CatalogTemplate`, snapshots |
| `backend/src/catalog/schema.ts` | Required/optional field list; structural YAML parse |
| `backend/src/catalog/primitives.ts` | `KNOWN_PLATFORM_PRIMITIVES` (sourced from MCP service) |
| `backend/src/catalog/baseline.ts` | `SAFE_BASELINE` definition; `isWithinBaseline()` |
| `backend/src/catalog/validator.ts` | Structural + semantic validation → named `FailureCode`s |
| `backend/src/catalog/source.ts` | Read templates from local dir or Git working tree |
| `backend/src/catalog/store.ts` | DB CRUD for `catalog_*` tables (camelCase mappers) |
| `backend/src/catalog/admission.ts` | State machine, batch sync orchestration, admission events |
| `backend/src/catalog/registrar.ts` | Map registered version → `capability_profiles` row |
| `backend/src/catalog/instantiate.ts` | Create managed `agents` row (no process boot) |
| `backend/src/catalog/migrate.ts` | Generate draft YAML from in-code definitions |
| `backend/src/catalog/orchestrator-tools.ts` | Prime control-plane tools: list, propose, instantiate |
| `backend/src/routes/catalog.ts` | Express router mounted at `/api/catalog` |

### Database tables

| Table | Purpose |
|-------|---------|
| `catalog_sources` | Named sync sources (local path or Git URL) |
| `catalog_templates` | One row per `templateId`; tracks `current_version_id` and `lifecycle_state` |
| `catalog_template_versions` | Immutable version snapshots; holds `resolved_definition` JSONB and admission state |
| `catalog_admission_events` | Append-only audit log of every state transition |
| `agents.catalog_template_version_id` | Provenance link from a managed agent back to its template version |

---

## Core concepts

### Template

A template is a complete declarative description of a class of agent: its identity, capability profile, runtime bounds, soul/persona, and approval policy. Templates are authored as YAML files and synced into the database. Each template has a stable `templateId` (slug) and carries versioning semantics — multiple versions of the same template can coexist in the database.

### Version

A version is an immutable snapshot of a template at a point in time. Once a version is `registered`, its `resolved_definition` is frozen; changing the YAML file and re-syncing creates a new version rather than mutating the existing one. The `current_version_id` pointer on the template row tracks which version is "current" for new instantiations.

### Managed agent

A managed agent is an `agents` row created from a registered template version. It has `execution_mode = 'managed'` and `catalog_template_version_id` set. No runtime process is started at creation — the on-demand `RuntimeLeaseManager` provisions a process when work actually arrives (no eager boot, no pet processes).

---

## Template file format

Templates live in `backend/catalog/` (the default local source) as YAML files, one template per file. The filename is conventionally `<templateId>.yaml`.

### Required fields

```yaml
templateId: researcher         # Stable slug — unique within the catalog
name: Researcher               # Human-readable display name
version: "1.0.0"              # Semver recommended; immutable once registered
agentType: researcher          # Agent type key
runtimeFamily: local           # Runtime family (local, opencode, acp, ...)
lifecycleIntent: durable       # durable | ephemeral
capabilityProfile:             # Declared powers (see below)
  platformPrimitives: []
  capabilityBundles: []
  denyRules: []
```

### Optional fields

```yaml
# Identity / personality
soul: "Careful, methodical researcher."
systemPrompt: |               # Inline system prompt
  You are a research specialist...
personaFile: prompts/agents/researcher.md  # Alternative: file reference

# Tool and credential access
mcpAccess:                    # Named MCP servers (must exist in mcp_servers table)
  - github
credentialNeeds:              # Named brokered credentials required at instantiation
  - GITHUB_TOKEN              # Never inline secret values here

# Runtime bounds
runtimeRequirements:
  limits:
    max_tokens: 40000
    max_duration_ms: 300000
    max_concurrent_processes: 1
  egress:
    allowlist:                # Empty = no egress allowed
      - api.github.com

# Approval policy
approvalPolicy:
  autoEligible: true          # Only honored if grants are within the safe baseline

# Routing hints for Prime dispatch
routing:
  preferredRole: researcher
  workClass: read-only
```

### `capabilityProfile` fields

```yaml
capabilityProfile:
  platformPrimitives:         # Recognized platform primitives
    - soul.read
    - memory.read
    - update_work_item
  capabilityBundles:          # Capability bundle names (resolved via capability_bundle_adapters)
    - repo.read
  denyRules:                  # Additional restrictions applied on top of the profile
    - kind: primitive
      primitive: delegate
      reason: "ephemeral agents cannot delegate"
    - kind: bundle
      bundle: repo.write
      reason: "read-only reviewer"
```

**Known platform primitives** (from `catalog/primitives.ts`): `delegate`, `request_peer_review`, `request_approval`, `update_work_item`, `soul.read`, `soul.write`, `memory.read`, `memory.write`, `lesson.read`, `lesson.write`, `context.assemble`, `loop.inspect`, `snapshot.create`, `fleet.learnings`, `pattern.publish`, `agent.soul.update`, `approval.resolve`.

---

## Admission state machine

Each template version passes through a linear state machine. Transitions are append-only in `catalog_admission_events`.

```
discovered ──▶ validated ──▶ pending_approval ──▶ registered ──▶ active
                   │
                   └──▶ rejected  (terminal until file is corrected and re-synced)
```

| State | Meaning |
|-------|---------|
| `discovered` | File read from source; not yet validated |
| `validated` | Passes structural and semantic checks; awaiting human approval |
| `rejected` | Failed validation; `failureReasons` records named codes |
| `pending_approval` | Queued for operator review (same as validated for non-auto-approved templates) |
| `registered` | Approved; capability profile created; eligible for instantiation |
| `active` | At least one managed agent has been created from this version |

### Failure codes

| Code | Meaning |
|------|---------|
| `MISSING_REQUIRED_FIELD` | A required top-level field is absent |
| `INVALID_FIELD_TYPE` | A field has the wrong type |
| `UNKNOWN_CAPABILITY_BUNDLE` | Bundle not found in `capability_bundle_adapters` |
| `UNKNOWN_PLATFORM_PRIMITIVE` | Primitive not in the recognized set |
| `UNKNOWN_MCP_SERVER` | MCP server not registered in `mcp_servers` |
| `UNKNOWN_CREDENTIAL` | Credential not found in the broker |
| `LEAST_PRIVILEGE_VIOLATION` | Declared tools or MCP servers exceed the capability profile |
| `SECRET_VALUE_PRESENT` | A field contains what looks like an inline secret |
| `APPROVAL_POLICY_DOWNGRADED` | Auto-approval claimed but grants exceed the safe baseline (warning, not error) |

---

## Sync sources

A **catalog source** is a named location the sync process reads templates from.

### Default local source

On first migration, a `default-local` source is seeded pointing to `backend/catalog/` (the source path stored in the `catalog_sources` table). Sync reads every `*.yaml` file in that directory.

### Adding a Git source

```bash
curl -XPOST localhost:8080/api/catalog/sources \
  -H 'content-type: application/json' \
  -d '{"kind":"git","name":"org-catalog","location":"/path/to/repo","defaultRef":"main","subpath":"catalog/"}'
```

When syncing a Git source, the supplied `ref` (branch/tag/SHA) is resolved to a concrete 40-character commit SHA at sync time. This SHA is recorded on every imported version, making provenance immutable even if the branch later advances.

### Triggering a sync

```bash
# Sync the default-local source
curl -XPOST localhost:8080/api/catalog/sync \
  -H 'content-type: application/json' -d '{}'

# Sync a named source at a specific ref
curl -XPOST localhost:8080/api/catalog/sync \
  -H 'content-type: application/json' \
  -d '{"sourceId":"<uuid>","ref":"v1.2.0"}'
```

### Batch isolation

A validation failure in one template never blocks other templates from admitting. Each template is processed independently. An already-registered version at the same `(templateId, version)` pair is skipped (`outcome: "duplicate"`) unless the content hash has changed.

---

## Approval and least-privilege

### The safe baseline

`catalog/baseline.ts` defines `SAFE_BASELINE`:

- **Allowed bundles**: `read-only`, `file-read`, `git-read`, `http-get`
- **Forbidden primitives**: anything write/deploy/production/sudo/root/network-write scoped

A template is "within the safe baseline" when its declared capability bundles are a subset of the allowed list and it declares none of the forbidden primitives.

### Auto-approval

A template is auto-approved (skips the human review queue) only when **both**:
1. `approvalPolicy.autoEligible: true` is set in the YAML, **and**
2. `isWithinBaseline(template)` returns `true`

If a template claims `autoEligible: true` but its grants exceed the baseline, it is accepted but the `APPROVAL_POLICY_DOWNGRADED` warning is recorded and it is routed to the human approval queue.

### Effective grant = declaration ∩ runtime policy

The tool grant created at instantiation is the intersection of:
- What the template declares in `capabilityProfile`
- What the runtime capability profile allows (from `capability_bundle_adapters` and `capability_profiles`)

The catalog can only *narrow* grants, never widen them. This is enforced by `resolveToolGrant` in `instantiate.ts` and cannot be overridden by catalog content.

### Human approval flow

Templates outside the safe baseline land in `pending_approval` and appear in the existing Approvals panel. The operator reviews the template definition and approves or rejects.

```bash
curl -XPOST localhost:8080/api/catalog/templates/architect/versions/1.0.0/approve \
  -H 'content-type: application/json' \
  -d '{"note":"reviewed — delegate primitive scoped to team-internal only"}'
```

---

## Versioning and rollback

### Creating a new version

Edit the YAML file, bump the `version` field, and re-sync. The new version enters the admission pipeline independently. The `current_version_id` pointer is updated to the new version only after it is registered.

### Rolling back

```bash
curl -XPOST localhost:8080/api/catalog/templates/implementer/rollback \
  -H 'content-type: application/json' \
  -d '{"version":"1.0.0"}'
```

Rollback points `current_version_id` back to the specified prior version. It does **not** delete the newer version — full history is retained. Running agents instantiated from any version are completely unaffected; they continue executing until their lease expires or they complete.

### Deprecating a template

```bash
curl -XPOST localhost:8080/api/catalog/templates/old-researcher/deprecate \
  -H 'content-type: application/json' -d '{}'
```

Deprecation sets `lifecycle_state = 'deprecated'` on the template row. New instantiations are blocked (`TEMPLATE_DEPRECATED`). Running agents are unaffected. The template and all its versions remain queryable for audit purposes.

---

## Instantiation and runtime

Instantiation creates the database records for a managed agent. No process is started.

```bash
curl -XPOST localhost:8080/api/catalog/templates/implementer/versions/1.0.0/instantiate \
  -H 'content-type: application/json' -d '{}'
# → 201 { "agentId": "...", "state": "active" }
```

What happens:
1. Version must be `registered` and the parent template must not be `deprecated`
2. All declared `credentialNeeds` must be provisioned in the credential broker — if any are missing, `412 CREDENTIAL_NOT_PROVISIONED` is returned and no agent is created
3. An `agents` row is created (`execution_mode='managed'`, `catalog_template_version_id` set)
4. An `agent_runtime_configs` row is created with limits from `runtimeRequirements`
5. A tool grant is resolved (declaration ∩ runtime policy) and persisted
6. MCP server names are resolved to IDs and `agent_mcp_assignments` rows created
7. The version transitions `registered → active`

When work is later delegated to this agent, `RuntimeLeaseManager` provisions a process (Launcher container or local OpenCode) and reclaims it when idle.

### Credential gate

```bash
# This returns 412 if GITHUB_TOKEN is not provisioned:
curl -XPOST localhost:8080/api/catalog/templates/github-agent/versions/1.0.0/instantiate \
  -H 'content-type: application/json' -d '{}'
# → 412 { "code": "CREDENTIAL_NOT_PROVISIONED", "missingCredentials": ["GITHUB_TOKEN"] }
```

Credentials are never stored in catalog files. They are provisioned separately through the credential broker and referenced by name in `credentialNeeds`.

---

## Migrating from in-code definitions

The built-in agent templates (implementer, reviewer, architect, SRE, DevOps) were originally hard-coded in `ephemeral-templates.ts` and `durable-staff.ts`. They have been migrated to `backend/catalog/`.

### How it works

`catalog/migrate.ts` reads the in-code `DEFAULT_EPHEMERAL_TEMPLATES` and `DEFAULT_DURABLE_STAFF` arrays and emits validated YAML drafts. The `POST /api/catalog/migrate` endpoint exposes this:

```bash
# Preview drafts (no files written)
curl -XPOST localhost:8080/api/catalog/migrate \
  -H 'content-type: application/json' -d '{}'

# Write YAML files to backend/catalog/
curl -XPOST 'localhost:8080/api/catalog/migrate?write=true' \
  -H 'content-type: application/json' -d '{}'
```

### Spawn and bootstrap behavior after migration

- `spawnEphemeralAgent(pool, 'implementer', ctx)` first checks the catalog for a registered version of `implementer`. If found, its definition is used. If not (e.g. catalog is empty or the template is not yet registered), the in-code literal is used as a fallback.
- `bootstrapDurableStaff(pool)` similarly loads durable templates from the catalog, merging with in-code fallbacks for any roles not yet seeded.

This means the catalog is the source of truth for agent definitions after initial seeding, but there is no hard dependency on the catalog being populated — the system continues to work with the in-code defaults.

### Adding a new agent type without code changes (SC-009)

After migration:
1. Create a YAML file in `backend/catalog/new-agent.yaml` with the required fields
2. Sync: `POST /api/catalog/sync`
3. Approve: `POST /api/catalog/templates/new-agent/versions/1.0.0/approve`
4. Instantiate: `POST /api/catalog/templates/new-agent/versions/1.0.0/instantiate`

No TypeScript changes required.

---

## Prime orchestrator integration

Prime (the orchestrator agent) can curate and instantiate agents from the catalog through three control-plane tools. The `catalog-curation` skill in `backend/prompts/skills/catalog-curation.md` describes the workflow.

### Tools

**`catalog_list_registered`**

Lists registered, non-deprecated templates. Accepts optional filters:
- `capability`: match `routing.preferredRole` or `capabilityBundles`
- `lifecycleIntent`: `"durable"` or `"ephemeral"`

**`catalog_propose_instantiation`**

Read-only: produces a rationale and tells Prime whether human approval is required before creating an agent. Accepts `intent` (keyword matched against soul/routing/bundles) and optional `templateId`. Always call this before `catalog_instantiate` and present the rationale to the operator.

**`catalog_instantiate`**

Creates the agent. Returns one of:
- `{ status: "active", agentId }` — auto-approved, agent is ready
- `{ status: "pending_approval", approvalId }` — human must approve in the Approvals panel
- `{ status: "blocked", code, detail }` — cannot instantiate; do not retry automatically

### Safety constraints

- Prime may never create agents outside the catalog (no direct writes to `agents`)
- Grants are enforced by `resolveToolGrant` regardless of what Prime requests
- Non-baseline templates always route through `pending_approval`; Prime cannot bypass this
- All Prime actions are recorded as `actor='prime'` admission events

### Example workflow

```
Operator: "Create a research specialist for the CI investigation."

Prime:
1. catalog_list_registered({ capability: "research" })
   → finds "researcher@1.0.0"

2. catalog_propose_instantiation({ intent: "investigate CI failures", templateId: "researcher" })
   → rationale: "Selected 'Researcher'. Read-only repo analyst. Auto-approval eligible."
     requiresHumanApproval: false

3. [Present rationale to operator, get confirmation]

4. catalog_instantiate({ templateId: "researcher", name: "CI Investigator" })
   → { status: "active", agentId: "abc-123" }

"Provisioned Research Specialist (ID: abc-123). It activates when work is delegated."
```

---

## REST API reference

All endpoints are mounted at `/api/catalog`.

### Templates

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/templates` | List all non-deprecated templates |
| `GET` | `/templates/:id` | Get template + version history (`:id` = templateId slug or UUID) |

### Sources

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/sources` | — | List configured sync sources |
| `POST` | `/sources` | `{ kind, name, location, defaultRef?, subpath? }` | Add a sync source |

### Sync

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/sync` | `{ sourceId?, ref? }` | Sync from a source; defaults to `default-local` |

### Admission actions

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/templates/:id/versions/:v/validate` | `{}` | `{ state, failureReasons }` |
| `POST` | `/templates/:id/versions/:v/approve` | `{ note? }` | `{ state: "registered", capabilityProfileId }` |
| `POST` | `/templates/:id/versions/:v/instantiate` | `{ name? }` | `201 { agentId, state }` or `412`/`409` |
| `POST` | `/templates/:id/rollback` | `{ version }` | `{ success, versionId }` |
| `POST` | `/templates/:id/deprecate` | `{}` | `{ success }` |

### Migration

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| `POST` | `/migrate` | `?write=true` | Generate YAML drafts from in-code definitions; `write=true` persists to `backend/catalog/` |

### Error responses

All errors use `{ error: string, code?: string }`.

| HTTP | Code | Meaning |
|------|------|---------|
| 400 | — | Bad request (missing required field in body) |
| 404 | — | Template, version, or source not found |
| 409 | `INVALID_STATE` | Version is not in the required admission state for this operation |
| 412 | `CREDENTIAL_NOT_PROVISIONED` | Declared credential not provisioned in the broker |
| 500 | — | Internal error |

---

## Operational notes

### Structured logs

All catalog operations emit structured console logs. Key log prefixes:

| Prefix | Operation |
|--------|-----------|
| `[catalog:sync]` | Sync start/end, per-entry outcomes |
| `[catalog:validate]` | Validation failures with named codes |
| `[catalog:approve]` | Registration + capability profile creation |
| `[catalog:instantiate]` | Agent creation, credential blocks |
| `[catalog:orchestrator]` | Prime tool calls |

### Audit trail

Every admission state transition is recorded in `catalog_admission_events`:
```sql
SELECT from_state, to_state, actor, reason, created_at
  FROM catalog_admission_events
 WHERE version_id = $1
 ORDER BY created_at;
```

`actor` is `'operator'` for human actions, `'prime'` for orchestrator-initiated actions, and `'system'` for auto-approved transitions.

### Content-hash idempotency

Syncing the same file content twice is a no-op: the sync pipeline computes a SHA-256 content hash and skips processing if an existing version with that hash already exists (regardless of admission state). This prevents re-admission of unchanged content on repeated syncs.

### Running the test suite

```bash
cd backend

# Unit tests (no DB)
npm test -- tests/catalog/validator.test.ts tests/catalog/migrate.test.ts

# Integration tests (requires test DB)
npm run test:db:up   # start postgres-test on port 55432
TEST_DATABASE_URL=postgresql://primeloop:primeloop_test@localhost:55432/primeloop_test \
  npm test -- tests/catalog/

# Via Docker (recommended — matches CI)
docker build -t primeloop-backend-test -f Dockerfile.test .
docker run --rm \
  --network 026-agent-catalog_default \
  -e TEST_DATABASE_URL=postgresql://primeloop:primeloop_test@postgres-test:5432/primeloop_test \
  primeloop-backend-test npm test -- tests/catalog/
```

### Common failure patterns

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `UNKNOWN_CAPABILITY_BUNDLE` on sync | Bundle not seeded in `capability_bundle_adapters` | Add the bundle adapter row |
| `CREDENTIAL_NOT_PROVISIONED` on instantiate | Named credential not in broker | Provision credential via the credential broker first |
| `INVALID_STATE` on approve | Version is `rejected` or already `registered` | Re-sync the corrected file or use the current registered version |
| `TEMPLATE_DEPRECATED` on instantiate | Template lifecycle is `deprecated` | Register a new template or un-deprecate via direct DB update |
| Rollback fails | Target version was never registered | Only registered (or formerly active) versions can be rolled back to |
