# Contract: Catalog REST API

`createCatalogRouter({ pool })`, mounted at `/api/catalog` in `backend/src/app.ts` (Express, JSON). Mirrors existing router conventions (`routes/agents.ts`, `routes/approvals.ts`). All responses are JSON; errors use `{ error: string, code?: string }`.

**Implementation status legend** (as of US1 backend): ✅ wired & verified · 🟡 stub (returns `{message:'… not implemented'}`) · ⬜ planned (later story). This doc reflects the *implemented* request/response shapes; planned endpoints describe intended behavior.

## Templates & versions

### `GET /api/catalog/templates` ✅
List templates. → `200 { templates: [...] }`. (Current implementation returns template rows; admission-state/summary enrichment is still TODO.)

### `GET /api/catalog/templates/:templateId` ✅
→ `200 { template, versions: TemplateVersion[] }` (versions include `admissionState`, provenance, `failureReasons`). `404` if unknown.

## Sync / import

### `POST /api/catalog/sync` 🟡 (stub — not yet wired)
Intended: import/sync from a source at a ref. Body: `{ sourceId?, ref? }` (default: the `default-local` source). Resolves a moving ref to a concrete SHA (FR-014), reads templates, validates each, advances admission per-entry. Batch: valid entries admit even if others fail (FR-015); never partially imports a failing entry (FR-008).
→ `200 { resolvedSha?: string, results: SyncEntryResult[] }` where
`SyncEntryResult = { templateId, version, outcome: 'admitted' | 'rejected' | 'duplicate', admissionState?, failureReasons?: FailureReason[] }`.

> The underlying service (`admission.syncFromLocalSource`) is implemented and covered by integration tests; only the HTTP handler at `routes/catalog.ts` is still a stub.

## Admission actions

### `POST /api/catalog/templates/:templateId/versions/:version/validate` ✅
Re-run validation. → `200 { state: 'validated' | 'rejected', failureReasons: FailureReason[] }`. `404` unknown version; `409 { code: 'INVALID_STATE' }` if the version can't be validated from its current state.

### `POST /api/catalog/templates/:templateId/versions/:version/approve` ✅
Human approval (pending_approval → registered). → `200 { state: 'registered', capabilityProfileId }`. `404` unknown version; `409 { code: 'INVALID_STATE' }` if not awaiting approval.

### `POST /api/catalog/templates/:templateId/versions/:version/instantiate` ✅
registered → active; creates a managed agent (no eager boot). → `201 { agentId, state: 'active' }`.
Errors: `412 { code: 'CREDENTIAL_NOT_PROVISIONED', missingCredentials: string[] }` when a declared credential is not provisioned in the broker; `409 { code }` for wrong state (e.g. not registered / no capability profile); `404` unknown version.

### `POST /api/catalog/templates/:templateId/rollback` ✅
Body: `{ version }` (the prior registered version to make current). Retains history (FR-022); running agents unaffected until re-instantiated (FR-023). → `200 { success: true, versionId }`. `400` if rollback fails (e.g. target was never registered).

### `POST /api/catalog/templates/:templateId/deprecate` ✅
→ `200 { success: true }`. Running agents unaffected; new instantiation blocked/warned. `404` unknown template.

## Sources ⬜ (planned — US3)

### `GET /api/catalog/sources` ⬜
→ `200 { sources: CatalogSource[] }`

### `POST /api/catalog/sources` ⬜
Body: `{ kind: 'local'|'git', name, location, defaultRef?, subpath? }` → `201 { source }`.

## Migration ⬜ (planned — US5)

### `POST /api/catalog/migrate` ⬜
Generate draft templates from existing in-code definitions (seed catalog). Body: `{ targets?: ('ephemeral'|'durable')[], write?: boolean }`. → `200 { drafts: DraftResult[] }`; with `write:true`, drafts are written to the default-local source. Does not interrupt running agents (FR-028).

## Invariants (cross-cutting)

- All admission transitions append to `catalog_admission_events` with actor + reason.
- No endpoint mutates a registered version's snapshot or a running managed agent.
- Effective grants on instantiation = declaration ∩ runtime policy (enforced via `resolveToolGrant`).
