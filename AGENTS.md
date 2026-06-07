# PrimeLoop Instructions

This repository is delegated to local OpenCode agents for both focused implementation tasks and larger end-to-end execution plans.

## Default Mode

- Prefer complete solutions over artificially narrow slices when a task clearly spans multiple files, layers, or phases.
- Build and execute a coherent plan when the user asks for issue completion, end-to-end implementation, or a complex feature.
- Group related changes into a single task when they are part of the same user goal and can be completed safely together.
- Prefer small, file-scoped changes when they are sufficient, but do not stop at an intermediate slice if the broader task is still unfinished.
- Do not refactor unrelated code.
- Do not modify files outside the task scope.
- If the task provides an exact schema or exact field list, copy it exactly.
- If the task is ambiguous, stop and report the ambiguity instead of guessing.
- When a task is large, finish the full requested scope whenever feasible:
  - implement the required code changes
  - update the relevant API/UI/contracts
  - run the requested verification
  - identify and close obvious follow-on gaps that are necessary for the requested feature to function coherently
- Do not split work into multiple turns unless:
  - the user explicitly wants phased delivery
  - a missing decision blocks safe implementation
  - the remaining work requires credentials, approvals, or external context you do not have

## Prime Agent Work

For Prime Agent implementation tasks:

- Prime is a native backend service, not an `agents` table row.
- Do not build on the older OpenCode Prime-as-worker design.
- Do not use `is_prime` as the implementation basis for the new Prime Agent.
- Keep Phase A limited to the exact schema, routing, queue, and service steps described in the current plan.

## Migration Rules

When editing `backend/src/db.ts`:

- Keep migrations idempotent.
- Add only the tables, columns, indexes, and seed rows explicitly requested.
- Do not invent extra indexes.
- Do not redesign table shapes.
- Preserve existing unrelated migrations.

## Runtime Harness Container Isolation (Launcher Path) [✓ COMPLETE]

This repository implements launcher-managed runtime isolation for managed local OpenCode agents. Instead of running agents as local processes, the launcher provisions isolated containers (via Docker or OpenSandbox) that run `opencode serve` and expose an ACP endpoint.

### Architecture Overview

```
Backend (OpenCodeProcessManager)
    ↓ HTTP/JSON-RPC
Launcher Service (provisions containers)
    ↓ Docker/OpenSandbox
OpenCode Runtime Container (opencode serve --port 8080)
    ↓ HTTP/JSON-RPC
AcpHarness (remote transport)
```

### Key Changes

1. **New launcher service**: A dedicated service (`backend/src/launcher/`) provisions isolated runtime containers per agent
2. **Backend integration**: The backend routes runtime provisioning through the launcher API with remote ACP endpoints instead of spawning local processes
3. **Docker Compose wiring**: Added `launcher` service for container management (OpenSandbox optional)
4. **Runtime containment**: Each agent runs in its own isolated container with scoped filesystem mounts and default-deny egress
5. **Remote ACP transport**: HTTP/JSON-RPC transport layer for communicating with remote OpenCode runtimes
6. **Recovery handling**: Backend restart reconciliation records explicit outcomes (reattached, reprovisioned, unavailable, cleaned_up)

### Documentation

See `specs/025-launcher-path-deployment/` for detailed documentation:
- `architecture.md`: Complete architecture overview and component breakdown
- `runtime-flow.md`: Detailed agent execution lifecycle
- `setup-guide.md`: Step-by-step setup instructions
- `plan.md`: Full implementation plan (OpenCode-first, Pi-deferral)
- `research.md`: Technical decisions and rationale
- `data-model.md`: Entity definitions and state transitions
- `contracts/launcher-api.yaml`: Launcher API contract with ACP endpoint structures
- `quickstart.md`: Deployment and verification steps

### Implementation Summary

**Phase 1 (Setup)**: ✓ Complete
- Launcher service source structure created in `backend/src/launcher/`
- Entrypoint scaffolding in `backend/src/launcher/index.ts`
- Package/build/runtime hooks added to docker-compose.yml
- OpenCode runtime image defined (`Dockerfile.opencode`)
- Environment variables and deployment prerequisites documented

**Phase 2 (Foundational)**: ✓ Complete
- Launcher auth token validation and request guards implemented
- Health reporting for Docker/OpenSandbox adapters implemented
- Backend-side launcher API client/helpers created
- Shared launcher/runtime status types with ACP endpoint structures added
- Recovery outcome recording and runtime-state reconciliation helpers implemented
- Observability hooks added for all launcher events

**Phase 3 (User Story 1 - MVP)**: ✓ Complete
- Launcher API routes implemented (POST /agents, GET /agents/{agentId}, POST /agents/{agentId}/restart, DELETE /agents/{agentId})
- Runtime slot/container lifecycle management implemented with OpenCode runtime family
- Docker Compose service wiring completed with OpenSandbox service
- Documentation updated for new default path (OpenCode-first)

**Phase 4 (User Story 2 - Lifecycle Operations)**: ✓ Complete
- Restart and teardown handlers implemented
- Backend restart reconciliation implemented
- Recovery outcomes recorded with explicit reasons
- Health degradation and stale-runtime clearing logic added

**Phase 5 (User Story 3 - Migration Path)**: ✓ Complete
- Migration-mode/runtime-mode compatibility checks implemented
- Rollout validation and rollback status signaling added
- End-to-end migration, validation, and rollback procedures documented

**Phase 6 (Polish & Cross-Cutting)**: ✓ Complete
- Launcher contract, quickstart, and plan/spec consistency reviewed
- Runtime containment enforcement audited
- Operator UX/status terminology reviewed

## Agent Catalog [✓ COMPLETE]

The Agent Catalog (spec 026) is implemented and live. All new managed agents must be created through the catalog. See `docs/agent-catalog.md` for the full architecture and usage guide.

### Key rules for catalog work

- **Never create agents by writing directly to the `agents` table.** Use `POST /api/catalog/templates/:id/versions/:v/instantiate` or the Prime control-plane tools (`catalog_instantiate`).
- **Never widen grants.** Effective grants = declaration ∩ runtime policy. `resolveToolGrant` enforces this at instantiation; do not attempt to bypass it.
- **All catalog writes flow through the state machine.** Do not update `catalog_template_versions.admission_state` directly. Use `approveVersion`, `validateVersion`, `rollbackVersion`, `deprecateTemplate` from `backend/src/catalog/admission.ts`.
- **`catalog_template_version_id` must be set** on every managed agent row created from a template version. `instantiateFromVersion` does this; direct inserts must include it.
- **`spawnEphemeralAgent` checks the catalog first.** The in-code `DEFAULT_EPHEMERAL_TEMPLATES` literals are now fallbacks only — the catalog is authoritative once the seed templates are registered.
- **`bootstrapDurableStaff` checks the catalog first.** Same pattern: catalog wins, in-code fallback used for unseeded roles.

### Module locations

| Concern | File |
|---------|------|
| Types | `backend/src/catalog/types.ts` |
| Validation | `backend/src/catalog/validator.ts` |
| Admission state machine | `backend/src/catalog/admission.ts` |
| DB store | `backend/src/catalog/store.ts` |
| Instantiation | `backend/src/catalog/instantiate.ts` |
| Migration from in-code | `backend/src/catalog/migrate.ts` |
| Prime tools | `backend/src/catalog/orchestrator-tools.ts` |
| REST router | `backend/src/routes/catalog.ts` |
| Seed YAML files | `backend/catalog/*.yaml` |
| Persona files | `backend/prompts/agents/*.md` |

### Catalog implementation phases [✓ ALL COMPLETE]

**US1 (Foundational)**: DB tables, validator, admission state machine, local sync, approve, instantiate
**US2 (Failure modes)**: All 13 failure codes, batch isolation, reject-then-fix workflow
**US3 (Versioning)**: Git sync with SHA provenance, versioning, rollback, deprecation
**US4 (Prime tools)**: `catalog_list_registered`, `catalog_propose_instantiation`, `catalog_instantiate`; Prime skill doc
**US5 (Migration)**: Seed YAML files, migrator, spawn/bootstrap repointed to catalog, parity tests

## Verification

- Run only the verification command requested in the task.
- Report changed files and the verification result.
- If verification fails, report the failure clearly and do not hide it.
- If no verification command is requested, do not invent one solely for process reasons.

<!-- SPECKIT START -->
Current Speckit plan: `specs/025-launcher-path-deployment/plan.md` (OpenCode-first, Pi-deferral)
<!-- SPECKIT END -->
