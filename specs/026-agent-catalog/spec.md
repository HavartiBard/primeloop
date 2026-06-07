# Feature Specification: Agent Catalog

**Feature Branch**: `026-agent-catalog`

**Created**: 2026-06-05

**Status**: Draft

**Input**: User description: "Define a reviewed, versioned catalog of agent templates. The catalog declares eligible agent types, capabilities, runtime requirements, MCP/Tool access, credential needs, approval policy, source repo/ref/path, and lifecycle intent. PrimeLoop's orchestrator remains the runtime authority and imports approved catalog entries into its DB as registered templates or managed agents."

## Overview

PrimeLoop today creates agents two ways: durable staff seeded at bootstrap and ephemeral specialists spawned from in-code templates (`ephemeral-templates.ts`). Both encode the agent's identity, capabilities, tool grants, and runtime requirements directly in source or ad-hoc database rows. There is no reviewed, versioned, declarative description of "what agents are allowed to exist, with what powers, and on what authority."

This feature introduces an **Agent Catalog**: a reviewed, versioned set of declarative **agent templates**. Each template is the **complete, modular agent definition** — its type, **full system prompt, soul, and persona**, capability profile, runtime requirements, MCP/tool access, credential needs, approval policy, provenance (source repo/ref/path), and lifecycle intent. The explicit goal is to **move agent configuration out of code**: the definitions that today live as TypeScript literals (`ephemeral-templates.ts`, `durable-staff.ts`) and persona files become catalog data.

The catalog can be **published to a Git repository** so definitions are **durable and shareable between operators/instances** (PrimeLoop remains single-tenant per instance — what is shared is the *definition*, not a running instance), but the Git repository is **optional and is never the live runtime state**. PrimeLoop's orchestrator remains the single runtime authority: it imports approved catalog entries into its own database as **registered templates** (blueprints) and, on explicit instantiation, as **managed agents**. Runtime health, credentials, sessions, work items, leases, and recovery stay owned by PrimeLoop and are never derived from the catalog.

The catalog is the *intent* layer; PrimeLoop's database remains the *truth* layer.

## Clarifications

### Session 2026-06-05

- Q: Where should the local catalog physically live, and what is the source-of-truth split between files and the database? → A: YAML files are the durable, shareable authoring/intent layer; the database is runtime truth and stores admission state plus an **immutable snapshot of each registered version**. Files win before registration (re-sync overwrites discovered/validated/pending staging); after registration the DB snapshot is frozen and editing a file produces a **new version** rather than mutating the registered one.
- Q: What does an agent template contain? → A: The **full, modular agent definition** — including the complete system prompt, soul, and persona — not just capability references. Moving this configuration out of code is an explicit goal of the feature.
- Q: How does the catalog relate to the existing in-code templates? → A: The catalog **becomes the source of agent configuration**. Delivery is incremental and non-breaking: a **built-in seed catalog** generated from today's literals (`implementer`, `reviewer`, durable staff) preserves day-one behavior, then the spawn and bootstrap-seed paths are repointed to read the catalog. The migration path (US5) is the mechanism that de-codes configuration.
- Q: When a registered template is instantiated (state → active), what happens at runtime? → A: Instantiation creates a **managed-agent record**; the existing on-demand RuntimeLease system (specs 024/025) boots a process only when work arrives. No eager boot ("cattle," per Constitution VI).
- Q: What approval taxonomy governs `pending approval → registered` and instantiation? → A: **Human approval by default**; a template MAY be flagged auto-approvable, honored **only when its grants fall within a safe baseline**; the stricter runtime policy always wins. Reuses the existing approval queue.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Import an approved template into the runtime (Priority: P1)

An operator has a validated agent template (for example, a "Research Specialist" with read-only repository tools and one MCP server). They review it, approve it, and import it so PrimeLoop registers it as a reusable blueprint. The agent does not start running on import; it becomes a registered template that can later be instantiated into a managed agent.

**Why this priority**: This is the core value — getting reviewed, least-privilege agent definitions into the runtime safely and on explicit human authority. Without it, nothing else in the catalog matters. It is a complete MVP on its own: a single local template can be validated, approved, registered, and instantiated.

**Independent Test**: Place one valid template in the local catalog, run admission, approve it, and confirm a registered template row appears in PrimeLoop with a capability profile and tool-grant defaults matching the declaration — and that no agent process was started until an explicit instantiation step.

**Acceptance Scenarios**:

1. **Given** a syntactically and semantically valid template in the local catalog, **When** the operator runs admission, **Then** the entry moves `discovered → validated` and is shown as awaiting approval.
2. **Given** a validated entry, **When** the operator approves it, **Then** the entry becomes `registered`, a corresponding template/blueprint exists in PrimeLoop's database with mapped capability profile and tool-grant defaults, and no managed agent has been created yet.
3. **Given** a registered template, **When** the operator instantiates it, **Then** PrimeLoop creates a managed agent bound to that template version, the agent appears in the runtime, and the entry is shown as `active`.
4. **Given** an approved import, **When** the operator inspects the registered template, **Then** its provenance (catalog source, ref/SHA, path, template version) is recorded and visible.

---

### User Story 2 - Author and validate templates with clear failure modes (Priority: P2)

A curator authors or edits a template and needs immediate, specific feedback about whether it is well-formed, internally consistent, and least-privilege before anyone is asked to approve it.

**Why this priority**: Trustworthy admission depends on validation that rejects malformed, over-privileged, or under-specified templates with actionable reasons. It protects the approval step from rubber-stamping unsafe definitions.

**Independent Test**: Feed a set of intentionally broken templates (missing required field, unknown capability bundle, credential referenced but not declared, tool grant broader than declared capabilities) and confirm each is rejected with a specific, named failure reason and never reaches `pending approval`.

**Acceptance Scenarios**:

1. **Given** a template missing a required field, **When** validation runs, **Then** the entry is marked `rejected` with a failure reason naming the missing field, and it is not eligible for approval.
2. **Given** a template that requests a capability, MCP server, or credential PrimeLoop does not recognize, **When** validation runs, **Then** it is `rejected` with a reason identifying the unknown reference.
3. **Given** a template whose tool grants exceed the powers implied by its declared capability profile, **When** validation runs, **Then** it is `rejected` for violating least-privilege.
4. **Given** a previously rejected template that has been corrected, **When** validation re-runs, **Then** it can progress to `validated`.

---

### User Story 3 - Publish and sync from a pinned Git commit, with versioning and rollback (Priority: P2)

A curator publishes the catalog to a Git repository for review and history. An operator points PrimeLoop at a specific commit SHA, syncs the approved entries, and can later roll the runtime back to a prior template version if a newer one misbehaves.

**Why this priority**: Versioned provenance and rollback are what make the catalog "reviewed and versioned" rather than just a config dump. They are valuable but build on the import and validation slices, so they follow P1/P2 core.

**Independent Test**: Sync the catalog from commit SHA A (registering version 1 of a template), then sync from SHA B (version 2), then roll back to version 1; confirm PrimeLoop's registered template reflects the rolled-back version and that the change is recorded with provenance.

**Acceptance Scenarios**:

1. **Given** a Git-published catalog, **When** the operator syncs from a specific commit SHA, **Then** every imported entry records that immutable SHA, ref, and path as its provenance.
2. **Given** a template already registered at version 1, **When** a newer version 2 is synced and approved, **Then** PrimeLoop retains version 1 as a prior version and marks version 2 current.
3. **Given** a problematic current version, **When** the operator rolls back, **Then** the previously registered version becomes current again without losing the version history, and already-running managed agents are unaffected until re-instantiated.
4. **Given** no Git source is configured, **When** the operator uses the catalog, **Then** templates are read from and written to the local catalog store and all import/validation/approval behavior is identical to the Git-backed path.

---

### User Story 4 - Orchestrator curates and instantiates agents from templates (Priority: P3)

PrimeLoop's orchestrator (Prime), through a dedicated skill, proposes and creates new agents from registered templates in response to operator intent — choosing an appropriate template, instantiating a managed agent within declared least-privilege bounds, and routing work to it.

**Why this priority**: This turns the catalog into an operational capability for Prime rather than a manual admin task, but it depends on templates already being registered and safe, so it is later in priority.

**Independent Test**: Give Prime an intent that matches a registered template, confirm the skill selects that template, requests instantiation, and (subject to approval policy) produces a managed agent whose grants never exceed the template's declared bounds.

**Acceptance Scenarios**:

1. **Given** a registered template and a matching operator intent, **When** Prime runs the catalog skill, **Then** it proposes instantiation of that template with a human-readable rationale.
2. **Given** an instantiation proposal, **When** the template's approval policy requires human approval, **Then** Prime routes it through the existing approval surface before any managed agent is created.
3. **Given** an instantiated managed agent, **When** it requests tools or credentials, **Then** its effective grants are the intersection of the template's declaration and PrimeLoop's runtime policy, never broader than declared.

---

### User Story 5 - Migrate manually-created agents into catalog templates (Priority: P3)

An operator with existing manually-created or in-code agents (durable staff, ephemeral templates) generates catalog templates that describe them, reviews the result, and adopts the catalog as the source of intent going forward without disrupting running agents.

**Why this priority**: Migration protects existing investment and makes the catalog adoptable, but it is only meaningful once authoring, validation, and import work.

**Independent Test**: Run the migration on an existing agent, confirm a draft template is produced that round-trips through validation to `validated`, and that adopting it does not interrupt the already-running agent.

**Acceptance Scenarios**:

1. **Given** an existing agent and its runtime config, **When** the operator runs migration, **Then** a draft template is generated capturing its type, capabilities, runtime requirements, tool grants, MCP assignments, and credential needs.
2. **Given** a generated draft template, **When** validation runs, **Then** it either reaches `validated` or reports specific gaps the operator must resolve.
3. **Given** an adopted migrated template, **When** it is registered, **Then** the existing running agent continues operating unchanged and is linked to the template version for future re-instantiation.

---

### Edge Cases

- **Drift between catalog and runtime**: A registered template is edited in Git but a managed agent is already running from the prior version. The running agent is unaffected; the catalog shows the new version as available, and re-instantiation is required to adopt it. The catalog never silently mutates a live agent.
- **Catalog references something PrimeLoop lacks**: A template names an MCP server, capability bundle, provider, or named credential that does not exist in PrimeLoop. Admission rejects it with a reason; it never partially imports.
- **Credential needs without a broker entry**: A template declares a credential need with no corresponding brokered credential configured. It can be validated but cannot be instantiated; instantiation is blocked with an explicit "credential not provisioned" outcome rather than starting an agent that will fail.
- **Duplicate or conflicting templates**: Two templates declare the same stable identifier, or two registered versions claim "current". Admission detects the conflict and rejects or requires the operator to resolve which is current.
- **Approval policy mismatch**: A template's declared approval policy is more permissive than PrimeLoop's runtime policy allows. The stricter policy wins; the declaration cannot widen runtime authority.
- **Sync from a moving ref**: An operator points at a branch name instead of a commit SHA. The system resolves and records the concrete commit SHA at sync time so provenance is immutable even if the branch later moves.
- **Deprecated template still in use**: A template is marked `deprecated` while managed agents instantiated from it are still running. Existing agents keep running; new instantiation from the deprecated template is blocked or warned.
- **Partial validation failure in a batch sync**: One entry in a synced commit is invalid. Valid entries still admit; the invalid one is `rejected` with a reason, and the sync reports per-entry outcomes rather than failing the whole batch silently.

## Constitution Alignment *(mandatory)*

- **Code Quality Plan**: Catalog templates are validated against an explicit schema with named, testable failure modes. Admission, mapping, and instantiation logic are covered by verification proportionate to their security weight (validation rules, least-privilege enforcement, provenance recording). Terminology (template, registered, managed agent, admission state) is defined once and reused.
- **YAGNI Check**: The Git-backed catalog is explicitly optional and defaults to a local store, avoiding a mandatory new service. No new runtime authority is introduced — the catalog reuses existing PrimeLoop concepts (capability profiles, tool grants, MCP assignments, credential broker, approval queue) rather than inventing parallel ones. The only genuinely new persistent concepts are the template, its versions, and its admission record; these are required to satisfy "reviewed and versioned."
- **Reliability & Operations**: Every admission transition and sync records provenance (source, ref/SHA, path, version) and a per-entry outcome. Failures are explicit states (`rejected`) with reasons, never silent partial imports. Rollback restores a prior registered version without losing history. Running managed agents are never mutated by catalog changes, so a bad template cannot destabilize in-flight work; recovery and runtime health remain owned by PrimeLoop.
- **UX Consistency**: Admission states are presented with consistent terminology and clear loading/empty/success/error states. Import, approval, and rollback reuse the existing approval and settings surfaces rather than introducing a parallel control path. The primary flow (review → approve → register → instantiate) is discoverable and predictable.
- **Design Consistency**: Catalog and admission views reuse existing settings/admin and approval-queue UI patterns and tokens; no new visual paradigm is introduced unless it raises overall coherence.
- **Primeloop Architecture Constraints**: Operator intent to create agents still routes through Prime and the existing approval surface. PrimeLoop's database remains the source of truth; the catalog (Git or local) is intent/publication only and never authoritative runtime state. Imported templates enforce per-agent least-privilege isolation, scoped runtime bounds, and brokered short-lived credentials — declarations can only narrow, never widen, runtime authority. Single-tenant assumptions are preserved.

## Requirements *(mandatory)*

### Functional Requirements

#### Catalog format & schema

- **FR-001**: The system MUST define a declarative template format in which each agent template declares the **complete, modular agent definition**, at minimum: a stable template identifier, display name, agent type/runtime family, **full system prompt, soul, and persona**, declared capabilities/capability profile, runtime requirements, MCP/tool access, credential needs, approval policy, provenance (source repo/ref/path), template version, and lifecycle intent.
- **FR-002**: The format MUST distinguish required fields from optional fields, such that a template missing any required field is invalid. (See "Key Entities" and the Template Schema appendix for the field-level required/optional breakdown.)
- **FR-003**: The system MUST support a **local catalog store** as the default when no Git source is configured, with identical authoring, validation, approval, and import behavior to the Git-backed path.
- **FR-004**: The system MUST support an **optional Git-published catalog** used for review, history, and sharing definitions between operators/instances only; the Git repository MUST NOT be treated as live runtime state.

#### Storage & source-of-truth split

- **FR-031**: The authoring/intent layer MUST be **YAML files** (local directory by default, optionally a Git repository); the **database** MUST be the runtime source of truth, holding admission state and an **immutable snapshot of each registered version**.
- **FR-032**: Re-syncing or editing files MUST overwrite only **un-registered** staging entries (`discovered`/`validated`/`pending approval`); a **registered** version's stored snapshot MUST be immutable, and a subsequent file edit MUST produce a **new version** rather than mutating the registered one.
- **FR-033**: The template MUST be able to carry the full agent definition either inline or by reference to modular files co-located in the catalog (e.g., persona/soul/system-prompt files); whichever encoding is used, the registered DB snapshot MUST capture the fully-resolved definition so it remains reproducible if the source files later change or disappear.

#### Moving configuration out of code

- **FR-034**: The system MUST provide a **built-in seed catalog** derived from the existing in-code definitions (`ephemeral-templates.ts` `implementer`/`reviewer`, `durable-staff.ts` staff) so that behavior is unchanged on first run.
- **FR-035**: The agent spawn path and the durable-staff bootstrap seed MUST be repointed to source their definitions from the catalog rather than in-code literals, such that adding or changing an agent definition no longer requires a code change.

#### Validation & failure modes

- **FR-005**: The system MUST validate each template for structural correctness (schema conformance) and semantic correctness (references resolve to known PrimeLoop concepts: capabilities, MCP servers, providers, credentials, approval policies).
- **FR-006**: The system MUST reject a template that requests tool/MCP/credential access exceeding the powers implied by its declared capability profile, enforcing least-privilege at admission time.
- **FR-007**: Every validation failure MUST produce a specific, named, human-readable reason and MUST prevent the entry from reaching `pending approval`.
- **FR-008**: The system MUST validate without side effects: a failing template MUST NOT partially import, start a process, or mutate any existing registered template or managed agent.

#### Admission lifecycle

- **FR-009**: The system MUST model the admission lifecycle with these states: `discovered`, `validated`, `rejected`, `pending approval`, `registered`, `deprecated`, and `active`, with defined, auditable transitions between them.
- **FR-010**: A template MUST NOT become `registered` without passing validation and satisfying its approval policy (human approval by default).
- **FR-011**: Registration MUST create a blueprint in PrimeLoop's database WITHOUT starting an agent; transition to `active` MUST require an explicit instantiation step that creates a **managed-agent record**. Instantiation MUST NOT eagerly boot a runtime process — the existing on-demand RuntimeLease system provisions a process only when work arrives and tears it down afterward (per Constitution VI).
- **FR-012**: The system MUST record every admission transition with provenance and actor (who/what caused it) for audit.

#### Import / sync from Git SHA

- **FR-013**: The system MUST import/sync approved catalog entries from a specified Git commit SHA into PrimeLoop's database, recording that immutable SHA, ref, and path as the imported entry's provenance.
- **FR-014**: When the operator specifies a moving ref (branch/tag), the system MUST resolve and persist the concrete commit SHA at sync time so provenance remains immutable.
- **FR-015**: A batch sync MUST report per-entry outcomes; valid entries MUST admit even if other entries in the same commit fail, and failures MUST NOT silently abort the batch.

#### Mapping to PrimeLoop concepts

- **FR-016**: The system MUST map template declarations onto existing PrimeLoop concepts: agents, agent runtime configs, capability profiles, capability bundles/tool grants, MCP assignments, credential (broker) references, leases, delegations, and routing — without introducing parallel runtime authorities.
- **FR-017**: A registered template MUST translate into a capability profile and tool-grant defaults consistent with the existing capability/tool-grant model, and an instantiated managed agent MUST receive grants no broader than the template declares.
- **FR-018**: Runtime-owned concerns — runtime health, credential issuance/rotation, sessions, work items, leases, and recovery — MUST remain owned and controlled by PrimeLoop and MUST NOT be derived from or overridden by the catalog.

#### Security model

- **FR-019**: Tool grants and MCP assignments derived from a template MUST be least-privilege: the effective runtime grant MUST be the intersection of the template declaration and PrimeLoop runtime policy, and a declaration MUST NOT widen runtime authority.
- **FR-020**: Credential needs declared in a template MUST be satisfied only through PrimeLoop's brokered, short-lived credential mechanism; the catalog MUST NOT contain secret values, and instantiation MUST be blocked with an explicit outcome when a declared credential is not provisioned.
- **FR-021**: A template's declared approval policy MUST NOT be able to bypass or weaken PrimeLoop's runtime approval and isolation policy; the stricter policy MUST always win.
- **FR-021a**: Approval MUST default to **human operator approval** via the existing approval queue. A template MAY declare itself **auto-approvable**, but auto-approval MUST be honored only when the template's effective grants fall within a defined **safe baseline** (e.g., read-only, no credential needs, no production/deploy or write-to-external capabilities); any template exceeding the baseline MUST require human approval regardless of its declaration.

#### Rollback & versioning

- **FR-022**: The system MUST retain prior registered versions of a template and MUST allow rollback to a previously registered version without losing version history.
- **FR-023**: Catalog changes (new versions, deprecation, rollback) MUST NOT mutate already-running managed agents; adopting a new version MUST require explicit re-instantiation.
- **FR-024**: The system MUST allow a template to be marked `deprecated`, after which new instantiation is blocked or warned while existing running agents continue unaffected.

#### UI / API changes

- **FR-025**: The system MUST expose an operator surface to view catalog entries and their admission state, review/approve pending entries, trigger import/sync, instantiate registered templates, and roll back versions, reusing existing settings/admin and approval patterns.
- **FR-026**: The system MUST expose programmatic operations (consumable by Prime's skill and by the UI) for listing, validating, importing/syncing, approving, instantiating, deprecating, and rolling back templates.

#### Migration path

- **FR-027**: The system MUST provide a migration capability that generates draft catalog templates from existing manually-created or in-code agents (durable staff, ephemeral templates), capturing their type, capabilities, runtime requirements, tool grants, MCP assignments, and credential needs.
- **FR-028**: Adopting a migrated template MUST NOT interrupt the corresponding already-running agent and MUST link that agent to a template version for future re-instantiation.

#### Orchestrator skill

- **FR-029**: The system MUST provide a skill for PrimeLoop's orchestrator to curate and instantiate agents from registered templates, selecting an appropriate template for an intent and producing an instantiation proposal with a human-readable rationale.
- **FR-030**: The orchestrator skill MUST route instantiation through the template's approval policy and the existing approval surface, and MUST never create a managed agent whose grants exceed the template declaration.

### Key Entities *(include if feature involves data)*

- **Catalog Template**: A declarative, versioned, **complete agent definition** — stable identifier, display name, agent type/runtime family, **full system prompt, soul, persona**, declared capabilities/capability profile, runtime requirements, MCP/tool access, credential needs, approval policy, provenance, version, and lifecycle intent. Authored as YAML files (durable, shareable); the unit of review and import. The fully-resolved definition is snapshotted into the DB on registration.
- **Catalog Source**: The origin of templates — either the **local catalog store** (default) or an **optional Git repository** identified by repo/ref/path. Publication and history only; never authoritative runtime state.
- **Template Version**: A specific, immutable revision of a template, pinned to a commit SHA (Git) or a local revision, retained to support rollback and version history.
- **Admission Record**: The lifecycle state of a template/version (`discovered`, `validated`, `rejected`, `pending approval`, `registered`, `deprecated`, `active`), with transition history, actor, and failure reasons.
- **Registered Template (Blueprint)**: The representation of an approved template inside PrimeLoop's database — mapped to a capability profile and tool-grant defaults — from which managed agents can be instantiated. Does not itself run.
- **Managed Agent (Instantiation)**: A running agent created from a registered template version, owned and controlled by PrimeLoop's runtime (state, health, sessions, leases, recovery), with grants no broader than its template declares.
- **Provenance Reference**: The immutable record of where a registered template came from — catalog source, resolved commit SHA, path, and template version.

### Template Schema (appendix — informative)

This appendix sketches the declarative template fields and their required/optional status to make FR-001/FR-002 testable. Field names and exact encoding are design decisions for the plan; the **set of declared concerns** is the requirement.

| Field | Required | Purpose |
|-------|----------|---------|
| `id` (stable identifier) | Required | Uniquely and durably identifies the template across versions |
| `name` (display name) | Required | Human-readable name |
| `version` | Required | Template revision for versioning/rollback |
| `agent_type` / `runtime_family` | Required | Which runtime family the agent belongs to |
| `lifecycle_intent` | Required | `durable` vs `ephemeral` and intended longevity |
| `system_prompt` (inline or file ref) | Required | The agent's full system prompt — moved out of code into the template |
| `soul` (inline or file ref) | Required | The agent's soul definition |
| `persona` (inline or file ref) | Required | The agent's persona content (replaces in-code persona files) |
| `capability_profile` (declared capabilities / bundles) | Required | The powers the agent is allowed, mapped to capability profiles/bundles |
| `tool_access` (tool grants) | Required | Tools the agent may use, bounded by the capability profile |
| `mcp_access` (MCP assignments) | Optional | MCP servers the agent may use |
| `credential_needs` | Optional | Named brokered credentials required (no secret values) |
| `runtime_requirements` (limits, isolation, workspace, egress allowlist) | Required | Runtime bounds the agent must run within |
| `approval_policy` | Required | Authority required to register/instantiate. Human by default; `auto_eligible` honored only when grants are within the safe baseline |
| `source` (repo/ref/path) | Optional | Provenance when published to Git; omitted for local-only templates |
| `routing` (capabilities/roles for dispatch) | Optional | How Prime should route work to instances |
| `description` / metadata | Optional | Notes, tags, ownership |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A valid template can be carried from `discovered` through `validated`, approval, `registered`, and `active` end-to-end, and this primary flow is covered by automated verification that passes before release.
- **SC-002**: 100% of templates that violate a required-field, unknown-reference, or least-privilege rule are rejected with a specific named reason and never reach approval; this is demonstrated by a fixture suite of intentionally broken templates.
- **SC-003**: Every registered template records immutable provenance (source, resolved commit SHA or local revision, path, version); an operator can identify the exact origin of any running managed agent in under 1 minute.
- **SC-004**: No catalog operation (new version, deprecation, rollback, failed sync) mutates or interrupts an already-running managed agent; this invariant is verified by automated tests.
- **SC-005**: An instantiated managed agent's effective tool/MCP/credential grants never exceed its template declaration, verified by tests that attempt to widen authority via the catalog and confirm the stricter runtime policy wins.
- **SC-006**: An operator can roll back a registered template to a prior version, and the runtime reflects the rolled-back version while retaining full version history, in a single operator action.
- **SC-007**: An existing manually-created agent can be migrated to a draft template that reaches `validated`, with no interruption to the running agent.
- **SC-008**: Operational failures (validation, sync, instantiation blocks) emit actionable, per-entry outcomes such that an operator can diagnose why an entry did not admit within 10 minutes.
- **SC-009**: After seeding the built-in catalog from existing in-code definitions, spawning and durable-staff bootstrap behave identically to the pre-catalog baseline (verified by automated tests), and a new or changed agent definition can be introduced with **zero code changes** — proving configuration has moved out of code.

## Assumptions

- **Approval authority**: By default the human operator approves entries (`pending approval → registered`) through PrimeLoop's existing approval surface; a template's `approval_policy` may mark low-risk entries as eligible for orchestrator/auto-approval, but it can only be *stricter* than, never override, runtime policy. PrimeLoop remains single-tenant, so "operator" is one human.
- **Registered ≠ running**: Registration produces a dormant blueprint; instantiation into a managed agent is always a separate, explicit step. This is why `registered` and `active` are distinct admission states.
- **Catalog is intent, DB is truth**: YAML files (Git or local) are the durable, shareable authoring/intent layer. PrimeLoop's database is the sole source of truth for runtime state and holds an immutable snapshot of each registered version; runtime health, credentials, sessions, work items, leases, and recovery are never derived from the catalog. Files win for un-registered entries; the DB snapshot is frozen once registered.
- **Config moves out of code**: The complete agent definition (system prompt, soul, persona, capabilities, runtime requirements) is migrated out of TypeScript literals into catalog templates. A built-in seed catalog generated from today's literals preserves day-one behavior; the spawn and durable-staff bootstrap paths are then repointed to read the catalog. This is a deliberate refactor of the agent-creation path, delivered incrementally rather than as a big-bang cutover.
- **Reuse existing subsystems**: The feature maps onto existing PrimeLoop concepts — capability profiles, capability bundles, tool grants, MCP registry/assignments, credential broker, approval queue, runtime configs, leases, delegations, and routing — rather than introducing parallel mechanisms.
- **Local-first default**: If the operator does not configure a discrete Git repository, templates and the catalog are stored locally with identical behavior; Git is desirable for publication and review history but optional.
- **Provenance immutability**: When a moving ref is supplied, the concrete commit SHA is resolved and recorded at sync time; provenance never depends on a branch that can later move.
- **No implementation in this phase**: This document specifies behavior and scope only. Concrete schema encoding, storage layout, API shapes, UI components, and the orchestrator skill's internals are produced in the plan and tasks phases.
- **Existing observability and design system reused**: Admission/audit logging, approval UI patterns, and settings/admin surfaces are reused where possible rather than rebuilt.
