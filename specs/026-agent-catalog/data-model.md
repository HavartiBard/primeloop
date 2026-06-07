# Phase 1 Data Model: Agent Catalog

New persistence lives in `backend/src/db.ts` as idempotent `CREATE TABLE IF NOT EXISTS` (+ `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`), consistent with the existing schema. Catalog **files** (YAML) are the authoring layer and are not persisted except as a resolved snapshot on registration.

## Entity overview

```
catalog_sources ──< catalog_template_versions >── catalog_templates
                                │
                                ├──< catalog_admission_events   (append-only transition log)
                                │
                                ├──> capability_profiles        (created/updated on registration)
                                │
                                └──< agents (catalog_template_version_id)  (provenance + linkage)
```

- A **template** (`catalog_templates`) is a stable identity (`template_id`) with a pointer to its current registered version.
- A **version** (`catalog_template_versions`) is an immutable snapshot of the fully-resolved definition + provenance + admission state.
- An **admission event** records each state transition (actor, reason).
- Registration maps a version to a `capability_profiles` row; instantiation creates an `agents` row linked back via `catalog_template_version_id`.

## Tables

### `catalog_sources`
Configured origins of templates. One local source exists by default.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `kind` | TEXT | `local` \| `git` |
| `name` | TEXT UNIQUE | operator label, e.g. `default-local` |
| `location` | TEXT | local: directory path; git: repo URL or path |
| `default_ref` | TEXT NULL | git only: default branch/tag to resolve |
| `subpath` | TEXT NULL | optional path within the source |
| `enabled` | BOOLEAN DEFAULT true | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

Seeded row: `{ kind: 'local', name: 'default-local', location: 'backend/catalog' }`.

### `catalog_templates`
Stable identity across versions.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `template_id` | TEXT UNIQUE | stable author-chosen identifier (e.g. `implementer`) |
| `name` | TEXT | display name (latest) |
| `current_version_id` | UUID NULL → `catalog_template_versions(id)` | the registered version currently in effect |
| `lifecycle_state` | TEXT DEFAULT 'available' | `available` \| `deprecated` |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

### `catalog_template_versions`
Immutable per-version snapshot. The unit of admission.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `template_pk` | UUID → `catalog_templates(id)` ON DELETE CASCADE | |
| `version` | TEXT | author-supplied version string (e.g. semver) |
| `admission_state` | TEXT | `discovered`,`validated`,`rejected`,`pending_approval`,`registered`,`deprecated`,`active` |
| `resolved_definition` | JSONB | fully-resolved template (prompt/soul/persona inlined) — frozen once `registered` |
| `content_hash` | TEXT | hash of `resolved_definition` for dedupe/idempotent sync |
| `source_id` | UUID NULL → `catalog_sources(id)` | where it came from |
| `commit_sha` | TEXT NULL | resolved immutable SHA (git); NULL for local |
| `source_path` | TEXT NULL | file path within the source |
| `source_ref` | TEXT NULL | original ref supplied (branch/tag) before resolution |
| `capability_profile_id` | UUID NULL → `capability_profiles(id)` | set on registration |
| `failure_reasons` | JSONB DEFAULT '[]' | named validation failures (see below) |
| `approval_id` | TEXT NULL → `approvals(approval_id)` | links to the approval-queue item |
| `auto_approved` | BOOLEAN DEFAULT false | true when admitted via safe-baseline auto-approval |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

Constraints/indexes:
- `UNIQUE (template_pk, version)` — one row per template+version.
- Index on `(admission_state)` and `(content_hash)`.
- **Immutability rule (enforced in `store.ts`, not a DB trigger)**: once `admission_state = 'registered'`, `resolved_definition`, `commit_sha`, `source_path`, `version` are never updated; a new file/content produces a new version row.

### `catalog_admission_events`
Append-only transition audit.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `version_id` | UUID → `catalog_template_versions(id)` ON DELETE CASCADE | |
| `from_state` | TEXT NULL | null for initial `discovered` |
| `to_state` | TEXT | |
| `actor` | TEXT | `operator` \| `prime` \| `sync` \| `migrate` |
| `reason` | TEXT NULL | e.g. failure code, approval note, rollback note |
| `metadata` | JSONB DEFAULT '{}' | |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |

### `agents` (modified)
Add provenance linkage (idempotent `ADD COLUMN IF NOT EXISTS`):

| Column | Type | Notes |
|--------|------|-------|
| `catalog_template_version_id` | UUID NULL → `catalog_template_versions(id)` ON DELETE SET NULL | the exact version this agent was instantiated/migrated from |

## Admission state machine

States: `discovered → validated → pending_approval → registered → (active ⇄ registered) → deprecated`; `rejected` is terminal-until-corrected.

```
discovered ──validate ok──> validated ──submit──> pending_approval
    │                          │                      │
    │                          │ validate fail        │ approve (human or safe-baseline auto)
    └──validate fail──> rejected <──┘                 ▼
                                                  registered ──instantiate──> active
       rejected ──(file corrected, re-sync)──> discovered      │  (≥1 running managed agent)
                                                                │ all instances retired
                                                  registered <──┘
                                                       │ deprecate
                                                       ▼
                                                  deprecated   (new instantiation blocked/warned;
                                                                running agents continue)
```

Transition rules:
- **discovered → validated**: structural + semantic validation passes (R6, R8).
- **\* → rejected**: any validation failure; `failure_reasons` populated. Re-sync of a corrected file restarts at `discovered`.
- **validated → pending_approval**: entry submitted for approval (auto if `auto_eligible` ∧ within safe baseline → immediately to `registered` with `auto_approved=true`).
- **pending_approval → registered**: human approves via approval queue, OR safe-baseline auto-approval. On entry: snapshot frozen, `capability_profile` upserted, `catalog_templates.current_version_id` set.
- **registered → active**: first managed agent instantiated from this version.
- **active → registered**: last running managed agent retired.
- **registered/active → deprecated**: operator deprecates; blocks/warns new instantiation; running agents unaffected.
- **Rollback** (FR-022): set `catalog_templates.current_version_id` back to a prior `registered` version; logged as an admission event on both versions. History retained.

## Validation rules → named failure codes

Emitted by `catalog/validator.ts`, stored in `failure_reasons` (each: `{ code, field?, detail }`). A failing template never reaches `pending_approval` (FR-007) and never partially imports (FR-008).

| Code | Meaning | Source |
|------|---------|--------|
| `MISSING_REQUIRED_FIELD` | A required field is absent/empty | FR-002 |
| `INVALID_FIELD_TYPE` | Field present but wrong shape | FR-005 |
| `UNKNOWN_RUNTIME_FAMILY` | `agent_type`/`runtime_family` not recognized | FR-005 |
| `UNKNOWN_CAPABILITY_BUNDLE` | Declared bundle not in `capability_bundle_adapters`/known set | FR-005 |
| `UNKNOWN_PLATFORM_PRIMITIVE` | Declared primitive unknown | FR-005 |
| `UNKNOWN_MCP_SERVER` | `mcp_access` names a server absent from `mcp_servers` | FR-005 |
| `UNKNOWN_CREDENTIAL` | `credential_needs` names a credential the broker does not know | FR-005 |
| `UNKNOWN_PROVIDER` | Referenced provider absent from `providers` | FR-005 |
| `LEAST_PRIVILEGE_VIOLATION` | `tool_access`/`mcp_access`/`credential_needs` exceeds the capability profile's implied powers | FR-006 |
| `DUPLICATE_TEMPLATE_ID` | Two entries share `template_id` within a sync | edge case |
| `VERSION_CONFLICT` | Two versions both claim current, or version re-used with different content | edge case |
| `SECRET_VALUE_PRESENT` | A field contains an inline secret value instead of a broker reference | FR-020 |
| `APPROVAL_POLICY_DOWNGRADED` | (warning, not reject) `auto_eligible` declared but grants exceed safe baseline → forced to human approval | FR-021/021a |

**Instantiation-time block (not a validation failure):** `CREDENTIAL_NOT_PROVISIONED` — a registered template can be validated but instantiation is blocked with an explicit outcome when a declared credential is not yet provisioned in the broker (edge case).

## Mapping summary (template → PrimeLoop concepts)

| Template field | Maps to |
|----------------|---------|
| `agent_type` / `runtime_family`, `lifecycle_intent` | `agents.type` / `runtime_family` / `tier`, `agents.state` |
| `system_prompt`, `soul`, `persona` | `agents.system_prompt`, `agents.soul`, `agents.persona_file` (resolved content) |
| `capability_profile` (primitives/bundles/deny) | `capability_profiles` row (upserted on registration) |
| `tool_access` | `agent_runtime_configs.tool_grant_defaults`; per-task `tool_grants` via `resolveToolGrant` |
| `mcp_access` | `agent_mcp_assignments` → `mcp_servers` |
| `credential_needs` | `CredentialBroker` named references (brokered short-lived; never inlined) |
| `runtime_requirements` (limits, fs scope, egress) | `agent_runtime_configs.limits`, runtime/launcher isolation (025) |
| `approval_policy` | approval-queue (008) routing + safe-baseline gate |
| `routing` | `routing_capability` / delegation routing |
| provenance (`source`, `version`, SHA) | `catalog_template_versions.*` + `agents.catalog_template_version_id` |
