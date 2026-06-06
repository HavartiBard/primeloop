# Contract: Catalog REST API

`createCatalogRouter({ pool })`, mounted at `/api/catalog` in `backend/src/app.ts` (Express, JSON). Mirrors existing router conventions (`routes/agents.ts`, `routes/approvals.ts`). All responses are JSON; errors use `{ error: string, code?: string }`.

## Sources

### `GET /api/catalog/sources`
List configured catalog sources. → `200 { sources: CatalogSource[] }`

### `POST /api/catalog/sources`
Add/update a source. Body: `{ kind: 'local'|'git', name, location, defaultRef?, subpath? }` → `201 { source }`. Errors: `400` invalid body.

## Templates & versions

### `GET /api/catalog/templates`
List templates with current admission state. Query: `?state=<admission_state>`. → `200 { templates: TemplateSummary[] }` where each summary includes `template_id, name, lifecycle_state, current_version, latest_state, has_running_agents`.

### `GET /api/catalog/templates/:templateId`
→ `200 { template, versions: TemplateVersion[] }` (versions include admission_state, provenance, failure_reasons). `404` if unknown.

## Sync / import

### `POST /api/catalog/sync`
Import/sync from a source at a ref. Body: `{ sourceId?, ref? }` (defaults: default-local source). Resolves a moving ref to a concrete SHA (FR-014), reads templates, validates each, advances admission per-entry. Batch: valid entries admit even if others fail (FR-015).
→ `200 { resolvedSha?: string, results: SyncEntryResult[] }` where
`SyncEntryResult = { templateId, version, outcome: 'validated'|'rejected'|'registered'|'unchanged', failureReasons?: FailureReason[] }`.
Never partially imports a failing entry (FR-008).

## Admission actions

### `POST /api/catalog/templates/:templateId/versions/:version/validate`
Re-run validation. → `200 { state, failureReasons }`.

### `POST /api/catalog/templates/:templateId/versions/:version/approve`
Human approval (pending_approval → registered). Body: `{ note? }`. Creates/links an approval-queue record. → `200 { state: 'registered', capabilityProfileId }`. Errors: `409` if not in `pending_approval`; `422` if validation not passed.

### `POST /api/catalog/templates/:templateId/versions/:version/instantiate`
registered → active; creates a managed agent (no eager boot). Body: `{ overrides?: { name? } }`. → `201 { agentId, state: 'active' }`. Errors: `409` if not registered/deprecated; `412 CREDENTIAL_NOT_PROVISIONED` if a declared credential is missing from the broker.

### `POST /api/catalog/templates/:templateId/deprecate`
→ `200 { lifecycle_state: 'deprecated' }`. Running agents unaffected; new instantiation blocked/warned.

### `POST /api/catalog/templates/:templateId/rollback`
Body: `{ toVersion }`. Sets current_version back to a prior registered version, retaining history (FR-022). Running agents unaffected until re-instantiated (FR-023). → `200 { currentVersion }`. Errors: `409` if `toVersion` was never registered.

## Migration

### `POST /api/catalog/migrate`
Generate draft templates from existing in-code definitions (US5 / seed catalog). Body: `{ targets?: ('ephemeral'|'durable'|'agentId')[], write?: boolean }`. → `200 { drafts: DraftResult[] }` where each draft is validated and reports `state` (`validated` or gaps). With `write:true`, drafts are written to the default-local source. Does not interrupt running agents (FR-028).

## Invariants (cross-cutting)

- All admission transitions append to `catalog_admission_events` with actor + reason.
- No endpoint mutates a registered version's snapshot or a running managed agent.
- Effective grants on instantiation = declaration ∩ runtime policy (enforced via `resolveToolGrant`).
