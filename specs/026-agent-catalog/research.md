# Phase 0 Research: Agent Catalog

All open decisions from the spec's `## Clarifications` session (2026-06-05) plus codebase inspection are consolidated here. No `NEEDS CLARIFICATION` markers remain.

## R1. Source-of-truth split: files vs database

- **Decision**: YAML files are the durable, shareable authoring/intent layer (local dir by default, optional Git repo). The database is runtime truth: it holds admission state and an **immutable snapshot of each registered version**. Files win for un-registered staging entries (re-sync overwrites them); a registered version's snapshot is frozen — editing a file produces a *new* version.
- **Rationale**: Satisfies "reviewed and versioned" with reproducible provenance. In local-only mode there is no Git SHA to anchor immutability, so the DB snapshot is the only durable anchor; this is what makes rollback (FR-022) and "never mutate a running agent" (FR-023) actually enforceable.
- **Alternatives considered**: Files-only (rejected: no immutability/rollback/audit, breaks local-only). DB-only authoring (rejected: loses Git review/diff/sharing UX the feature exists for).

## R2. Template content: complete modular agent definition

- **Decision**: A template carries the full agent definition — `system_prompt`, `soul`, `persona` (inline or co-located file reference), plus capability profile, runtime requirements, MCP/tool access, credential needs, approval policy, provenance, version, lifecycle intent. The registered DB snapshot stores the **fully-resolved** definition.
- **Rationale**: Explicit goal is to move agent configuration out of code (`ephemeral-templates.ts`, `durable-staff.ts`, `prompts/agents/*`). Resolving references at registration keeps a running agent reproducible even if source files later change/disappear.
- **Alternatives considered**: Capability-reference-only templates (rejected: leaves prompts/soul in code, defeats the goal). Always-inline (allowed but not required: large prompts are awkward in YAML, so file references are supported and resolved at registration).

## R3. Relationship to in-code templates — catalog becomes the source

- **Decision**: The catalog becomes the source of agent configuration. Delivery is incremental and non-breaking: `catalog/migrate.ts` generates a **built-in seed catalog** from today's `DEFAULT_EPHEMERAL_TEMPLATES` and `DEFAULT_DURABLE_STAFF` (+ persona files); then `spawnEphemeralAgent` and `bootstrapDurableStaff` are repointed to read the catalog, with the in-code literals retained only as an emergency fallback until cutover is verified.
- **Rationale**: Achieves config-out-of-code (SC-009) without a risky big-bang on the agent-creation hot path. The seed catalog guarantees identical day-one behavior.
- **Alternatives considered**: Big-bang rewrite (rejected: high blast radius on spawn/bootstrap). Permanent coexistence (rejected: contradicts the stated goal).

## R4. Instantiation & runtime ownership

- **Decision**: Instantiation creates a managed-agent record (an `agents` row, tier from `lifecycle_intent`, runtime config + MCP assignments + tool-grant defaults), linked to its `catalog_template_version_id`. It does **not** boot a process. The existing `RuntimeLeaseManager` (specs 024/025) provisions a runtime on demand when work arrives and reclaims it when idle.
- **Rationale**: Constitution VI (cattle, not pets; recover from durable log). Reuses merged 025 launcher/lease machinery rather than adding a parallel runtime path.
- **Alternatives considered**: Eager boot at instantiation (rejected: always-on pets, contradicts constitution). Catalog owning runtime lifecycle (rejected: violates "PrimeLoop owns runtime").

## R5. Approval taxonomy & safe baseline

- **Decision**: Human approval by default through the existing approval queue (008). A template may declare `auto_eligible`, honored **only** when its effective grants fall within a defined **safe baseline** (`catalog/baseline.ts`): read-only capability bundles, no `credential_needs`, no write-to-external / deploy / production primitives, default-deny egress with empty or trivial allowlist. Anything exceeding the baseline requires human approval regardless of declaration; the stricter runtime policy always wins.
- **Rationale**: Lets genuinely low-risk templates flow without ceremony while keeping powerful config (prompts, write/deploy/credential grants) gated by a human. Encoding the baseline as data keeps the rule auditable and testable.
- **Alternatives considered**: Always-human (rejected: needless friction for read-only helpers). Per-template free choice (rejected: a declaration could widen effective authority — unsafe).

## R6. YAML parsing & schema validation libraries

- **Decision**: Add the `yaml` package for parse/stringify. Hand-roll structural + semantic validation in `catalog/validator.ts`, emitting named `FailureCode`s. Do **not** add `zod`/`ajv`.
- **Rationale**: YAML parsing must be safe and is non-trivial, so a library is warranted. Validation in this codebase is already hand-written (`isRecord`-style checks in `routes/*`); matching that keeps the dependency surface minimal (YAGNI) and gives full control over operator-facing failure messages.
- **Alternatives considered**: `zod`/`ajv` (rejected: new dependency + idiom the codebase doesn't use; failure-code/message control is easier hand-rolled). `js-yaml` (acceptable; `yaml` chosen for round-trip stringify used by the migrator).

## R7. Git access for sync

- **Decision**: Use `child_process` to invoke the system `git` for: resolving a ref to a concrete commit SHA, and reading template files at that SHA (`git -C <repo> rev-parse <ref>`, `git -C <repo> show <sha>:<path>` / `ls-tree`). Local sources read directly from the filesystem.
- **Rationale**: Trivial operations, `git` already present, avoids a library dependency. Resolving ref→SHA at sync time gives immutable provenance even if a branch later moves (FR-014).
- **Alternatives considered**: `simple-git`/`nodegit` (rejected: unjustified weight). A long-lived clone/daemon (rejected: catalog is intent, not a live service).

## R8. Mapping onto existing PrimeLoop concepts

- **Decision**: Register a version by upserting a `capability_profiles` row (from declared `platform_primitives`/`capability_bundles`/`deny_rules`) and storing resolved `tool_grant_defaults`, MCP server references (by name → `mcp_servers`), and credential references (names → `CredentialBroker`) on the template version. Instantiation creates the `agents` row + `agent_runtime_configs` + `agent_mcp_assignments`, and per-task tool grants continue to flow through the existing `resolveToolGrant` (which already narrows to the intersection).
- **Rationale**: No parallel authority — the catalog feeds the existing capability/tool-grant/MCP/credential machinery. Least-privilege is enforced by the same `resolveToolGrant` path that ephemeral spawns already use.
- **Alternatives considered**: New catalog-specific grant tables (rejected: duplicates `tool_grants`/`capability_profiles`, violates YAGNI and the "map onto existing concepts" requirement).

## R9. Orchestrator skill surface

- **Decision**: Expose catalog curation/instantiation to Prime as control-plane tools registered through the existing `mcp/service.ts` `listControlPlaneTools` mechanism (e.g., `catalog.list_registered`, `catalog.propose_instantiation`, `catalog.instantiate`), plus a skill prompt doc describing curation behavior. Instantiation proposals route through the approval policy/queue.
- **Rationale**: Prime already drives agents via control-plane tools; reuse that surface rather than inventing a new integration. Keeps Prime model-agnostic.
- **Alternatives considered**: A bespoke Prime↔catalog channel (rejected: parallel control path, violates "intent through Prime / existing surfaces").
