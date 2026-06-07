# Quickstart: Agent Catalog

End-to-end validation of the primary flow (SC-001) plus the key invariants. Assumes the backend test DB is up (`npm run test:db:up` from `backend/`, or a running instance).

## 1. Seed the built-in catalog (config out of code)

```bash
# Generate draft templates from existing in-code definitions into backend/catalog/
curl -s -XPOST localhost:8080/api/catalog/migrate -H 'content-type: application/json' \
  -d '{"targets":["ephemeral","durable"],"write":true}' | jq
```
**Expect**: drafts for `implementer`, `reviewer`, `architect`, `sre`, `devops`, each `state: "validated"`. Files appear in `backend/catalog/*.yaml` with system prompt / soul / persona inlined. (SC-009)

## 2. Sync & inspect admission state

```bash
curl -s -XPOST localhost:8080/api/catalog/sync \
  -d '{}' -H 'content-type: application/json' | jq '.results'
curl -s localhost:8080/api/catalog/templates | jq '.templates[] | {template_id, latest_state}'
```
**Expect**: per-entry `outcome` values; templates listed as `validated`.

## 3. Reject an invalid template (failure modes, SC-002)

Drop a broken file (missing `version`, unknown bundle, or a tool grant beyond its profile) into `backend/catalog/` and re-sync.

**Expect**: that entry → `outcome: "rejected"` with a named `failureReasons` code (`MISSING_REQUIRED_FIELD` / `UNKNOWN_CAPABILITY_BUNDLE` / `LEAST_PRIVILEGE_VIOLATION`); other entries still admit (batch isolation, FR-015); the rejected entry never reaches `pending_approval`.

## 4. Approve → register

```bash
curl -s -XPOST localhost:8080/api/catalog/templates/implementer/versions/1.0.0/approve \
  -d '{"note":"reviewed"}' -H 'content-type: application/json' | jq
```
**Expect**: `state: "registered"`, a `capabilityProfileId`; a `capability_profiles` row exists; **no agent created yet** (US1 scenario 2).

## 5. Instantiate (no eager boot)

```bash
curl -s -XPOST localhost:8080/api/catalog/templates/implementer/versions/1.0.0/instantiate \
  -d '{}' -H 'content-type: application/json' | jq
```
**Expect**: `201 { agentId, state: "active" }`; an `agents` row with `catalog_template_version_id` set and grants no broader than declared; **no runtime process started** until work arrives (RuntimeLeaseManager provisions on demand). (FR-011, SC-005)

## 6. Provenance lookup (SC-003)

```bash
curl -s localhost:8080/api/catalog/templates/implementer | jq '.versions[0] | {version, commit_sha, source_path, admission_state}'
```
**Expect**: immutable provenance recorded (local revision or resolved SHA).

## 7. Versioning & rollback (SC-006)

1. Edit `implementer.yaml` → bump `version` to `1.1.0`, re-sync, approve. Current version becomes `1.1.0`; `1.0.0` retained.
2. Roll back:
```bash
curl -s -XPOST localhost:8080/api/catalog/templates/implementer/rollback \
  -d '{"toVersion":"1.0.0"}' -H 'content-type: application/json' | jq
```
**Expect**: `currentVersion: "1.0.0"`, full history retained, **already-running agent from step 5 unaffected** (SC-004) until re-instantiated.

## 8. Credential block (edge case)

Register a template declaring a `credentialNeeds` entry the broker doesn't have, then instantiate.

**Expect**: `412 { code: "CREDENTIAL_NOT_PROVISIONED" }` — no agent created.

## 9. Prime curation (US4)

Via Prime: an intent matching a registered template → `catalog.propose_instantiation` returns a rationale; `catalog.instantiate` on a non-baseline template returns `pending_approval` (routes through approval queue), never creating an over-privileged agent. (FR-030)

## Automated coverage

- Unit (no DB): `tests/catalog/validator.test.ts` (every failure code), `tests/catalog/baseline.test.ts` (auto-approval gating), `tests/catalog/mapper.test.ts` (template → capability profile/grants).
- Integration (DB): `tests/catalog/admission.test.ts` (state machine + batch sync), `tests/catalog/instantiate.test.ts` (no eager boot, grant intersection, credential block), `tests/catalog/rollback.test.ts` (no mutation of running agents), `tests/catalog/migrate.test.ts` (seed parity with in-code, SC-009).
