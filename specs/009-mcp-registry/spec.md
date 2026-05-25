# Feature Specification: Capability Registry + Per-Agent Tool Scoping

**Feature Branch**: `009-mcp-registry`

**Created**: 2026-05-21

**Status**: Draft

**Input**: "Define ACP's layered tooling model so agents receive only the minimum platform primitives, capability bundles, provider adapters, and per-run tool grants needed for their role and current task."

## Summary

This spec turns tooling into a first-class ACP primitive instead of leaving it as raw MCP assignment. The registry defines and resolves four layers:

- **Platform primitives**: stable ACP-native actions such as `delegate`, `request_approval`, `update_work_item`, and `publish_artifact`
- **Capability bundles**: policy-level groupings such as `repo.read`, `repo.write`, `ci.inspect`, `deploy.staging`, or `kb.search`
- **Provider adapters**: concrete implementations via MCP servers, HTTP APIs, stdio processes, CLIs, or SDK-backed integrations
- **Tool grants**: per-agent, per-run resolved access derived from role, task scope, approval state, environment, and explicit constraints

The goal is twofold:

1. ACP can evolve provider implementations and internal tooling contracts without rewriting agent-facing behavior.
2. Every durable or ephemeral agent receives the narrowest usable tool surface for its current assignment.

This spec builds on `002`: the harness resolves a tool grant at spawn/start time and writes only the necessary provider adapters and platform primitives into the agent runtime configuration.

## Key Decisions (Do Not Re-Open Without Amending the Constitution)

- **Layered model**: Agents bind first to platform primitives and capability bundles, not directly to infrastructure adapters by default
- **Deny-by-default**: No agent receives a capability or adapter unless explicitly granted through profile resolution
- **Stable contracts**: ACP-native platform primitives are treated as stable behavioral contracts even when underlying implementations change
- **Swappable providers**: Provider adapters are replaceable behind capabilities without requiring prompt or workflow redesign for agents
- **Per-run resolution**: Final access is decided at execution time as a `Tool Grant`, not as a static forever-assignment
- **Durable baseline vs ephemeral minimization**: Durable staff get role-appropriate baseline capability profiles; ephemerals get task-scoped minimal grants
- **Approval-aware scoping**: High-impact provider adapters and capabilities can be present in profiles but withheld from final tool grants until approval conditions are satisfied
- **Current ACP basis**: Existing `capabilities`, control-plane tools, `mcp_servers`, and `agent_mcp_assignments` are extended into the new model rather than discarded
- **Routing/tooling split**: Delegation routing labels remain distinct from tooling capability bundles and from concrete provider adapter identities
- **Grant-filtered primitives**: Control-plane primitives are filtered into the final tool grant and also validated server-side on invocation
- **Primitive/API mapping**: Canonical platform primitive names are architectural contracts; current MCP/control-plane tool names may be implementation-specific wrappers mapped onto those contracts

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Spawn with the minimum viable tool grant (Priority: P1)

When ACP starts an agent for a specific task, it should expose only the platform primitives, capabilities, and provider adapters required for that task.

**Why this priority**: Least-privilege execution is the main safety property of the tooling model and the reason to formalize grant resolution.

**Independent Test**: Can be fully tested by spawning an agent for a narrow task, inspecting its generated runtime config, and verifying only the intended primitives and adapters are present.

**Acceptance Scenarios**:

1. **Given** an ephemeral QA task that only needs repo read and verification capabilities, **When** the harness resolves the tool grant, **Then** the spawned agent receives those capabilities and no repo write or deploy access
2. **Given** a task with explicit scope constraints, **When** the runtime config is written, **Then** only provider adapters mapped from the resolved capability bundle appear in that config
3. **Given** an agent receives a resolved tool grant, **When** it lists available tools, **Then** it sees only the granted ACP primitives and adapter-backed tools

---

### User Story 2 - Update durable staff capability profiles without identity churn (Priority: P2)

When ACP changes the tooling policy for a durable role, it should reconcile the new capability profile onto the existing durable agent without creating a new agent identity or worktree.

**Why this priority**: Durable staff need stable identities, but their tool surfaces will evolve as ACP matures.

**Independent Test**: Can be tested by updating a durable agent's capability profile and verifying the agent keeps the same identity while its next resolved tool grant reflects the new policy.

**Acceptance Scenarios**:

1. **Given** an existing Architect durable agent, **When** its capability profile adds `kb.write`, **Then** the durable agent keeps the same agent record and picks up the new grant on reconciliation
2. **Given** a durable agent is currently running a task, **When** its capability profile changes, **Then** the current run keeps its existing grant and the new profile applies to subsequent runs unless explicitly hot-reloaded
3. **Given** a capability profile removes a high-risk adapter, **When** reconciliation runs, **Then** the removed adapter is no longer exposed in future durable-agent runtime configs

---

### User Story 3 - Swap provider adapters behind a capability contract (Priority: P3)

When ACP changes the concrete implementation of a capability, agents should continue to reason about the same capability contract.

**Why this priority**: This is the modularity benefit that makes ACP easier to evolve and eventually self-improve safely.

**Independent Test**: Can be tested by remapping one capability bundle from one provider adapter to another and verifying agent tasks continue to request the capability rather than the old adapter directly.

**Acceptance Scenarios**:

1. **Given** `repo.read` is backed by one MCP adapter, **When** ACP remaps it to a different adapter, **Then** Prime and subagents continue requesting `repo.read` rather than the provider name
2. **Given** a provider adapter becomes unhealthy, **When** ACP has an alternate adapter for the same capability, **Then** future tool grants can resolve to the alternate adapter without changing agent-facing task contracts

---

### User Story 4 - Gate dangerous adapters behind approval-aware grants (Priority: P4)

When a role is allowed to perform sensitive operations, ACP should still be able to withhold direct infrastructure access until a specific task has approval.

**Why this priority**: High-risk access should be expressible in the model without making every privileged role permanently overpowered.

**Independent Test**: Can be tested by assigning a role a profile that includes production deploy capability, creating one unapproved and one approved task, and verifying only the approved run receives the deploy adapter in its resolved grant.

**Acceptance Scenarios**:

1. **Given** DevOps has a profile that includes `deploy.production` behind approval, **When** an unapproved task is spawned, **Then** the final tool grant excludes the production deploy adapter
2. **Given** the same task has an approved escalation, **When** the tool grant is resolved, **Then** the production deploy adapter is included for that run only

---

### Edge Cases

- What happens when a capability profile references a provider adapter that no longer exists?
- What happens when multiple provider adapters satisfy the same capability but one is unhealthy?
- How does ACP behave when a durable agent's assigned profile conflicts with a narrower task-scoped constraint?
- What happens when an approval is revoked after a run has already started with an elevated tool grant?
- How does ACP resolve grants when a task needs a platform primitive but no external provider adapter?
- What happens when a provider adapter requires secrets that are unavailable from the credential layer?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST define ACP tooling as four layers: platform primitives, capability bundles, provider adapters, and per-run tool grants
- **FR-002**: System MUST maintain a registry of ACP-native platform primitives with stable names, schemas, and access constraints
- **FR-003**: System MUST maintain a registry of capability bundles that describe policy-level permissions independently of specific provider adapters
- **FR-004**: System MUST maintain a registry of provider adapters describing transport type, lifecycle behavior, required credentials, and capability mappings
- **FR-005**: System MUST resolve a `Tool Grant` for every agent run from the agent's role/profile, task scope, approval state, environment, and explicit deny rules
- **FR-006**: System MUST default to deny-by-default when no explicit capability or primitive grant exists
- **FR-007**: System MUST allow capability bundles to map to one or more provider adapters
- **FR-008**: System MUST allow ACP-native platform primitives to be granted independently of external provider adapters
- **FR-009**: System MUST allow provider adapters to be replaced behind a capability bundle without changing the capability name used by Prime or subagents
- **FR-010**: System MUST allow role-level `Capability Profiles` for Prime, durable staff roles, and named ephemeral templates
- **FR-011**: System MUST allow task-scoped narrowing constraints that reduce a role's default capability profile for a specific run
- **FR-012**: System MUST support approval-gated capabilities and provider adapters that are withheld from a tool grant until the required approval state is satisfied
- **FR-013**: System MUST support baseline control-plane primitives for non-Prime agents while still allowing some primitives to be marked Prime-only
- **FR-014**: System MUST preserve the distinction between Prime-only primitives and generally delegable primitives
- **FR-015**: System MUST surface enough metadata for the harness to write only the granted provider adapters and primitives into the agent runtime configuration
- **FR-016**: System MUST ensure that unresolved or invalid provider adapter references cause grant resolution failure rather than silent over-broad fallback
- **FR-017**: System MUST support health-aware provider selection when multiple adapters can satisfy the same capability
- **FR-018**: System MUST support a deterministic precedence order for grant resolution:
  - explicit deny rules
  - task-scoped narrowing rules
  - approval state
  - role/template capability profile
  - environment/runtime availability
  - provider health and fallback
- **FR-019**: System MUST make the resolved tool grant inspectable for audit and debugging after a run is created
- **FR-020**: System MUST record which capability bundles and provider adapters were granted to each run
- **FR-021**: System MUST record why a capability or adapter was excluded when exclusion is due to approval, deny rules, health, or missing credentials
- **FR-022**: System MUST support reconciliation of updated capability profiles onto durable agents without duplicating agent identities
- **FR-023**: System MUST allow current runs to keep their resolved grant while future runs use an updated capability profile, unless an explicit emergency revocation path is triggered
- **FR-024**: System MUST define an emergency revocation path for currently running grants when a provider adapter or credential is revoked for safety reasons
- **FR-025**: System MUST extend the current ACP model where agent `capabilities`, control-plane tools, `mcp_servers`, and `agent_mcp_assignments` exist, rather than introducing an unrelated second registry
- **FR-026**: System MUST support provider adapters implemented through MCP stdio, MCP HTTP/SSE, HTTP APIs, CLI tools, and SDK-backed local integrations
- **FR-027**: System MUST define which provider adapters are harness-managed for lifecycle purposes versus externally managed
- **FR-028**: System MUST allow capability profiles to refer to durable artifacts and policy rules without embedding provider-specific details into persona files
- **FR-029**: System MUST support minimal default capability profiles for ephemeral templates, with explicit expansion only where required
- **FR-030**: System MUST support broader but still bounded default capability profiles for durable staff roles
- **FR-031**: System MUST keep provider adapter credential requirements separate from role policy so secrets can be rotated without changing capability definitions
- **FR-032**: System MUST expose integration points for spec `010` credential brokering so tool grants can request the secrets required by their selected provider adapters
- **FR-033**: System MUST provide enough structure for spec `003` durable staff bootstrap to assign role-default capability profiles
- **FR-034**: System MUST provide enough structure for spec `005` ephemeral specialist templates to declare template-default capability profiles and task-scoped narrowing rules
- **FR-035**: System MUST define an explicit mapping from canonical platform primitives to current runtime-exposed tool/API names where those differ in Phase A
- **FR-036**: System MUST allow current tool names such as `delegate_to_agent` or `request_peer_review` to remain as implementation details while the architecture reasons in terms of stable primitive contracts

### Storage Model

- **SM-001**: Phase A MUST persist reusable capability-profile definitions in a DB-backed store or a DB-backed/file-backed hybrid with a canonical persisted identifier
- **SM-002**: Phase A MUST persist provider-adapter definitions and capability-to-adapter mappings separately from agent persona files
- **SM-003**: Phase A MUST persist resolved per-run tool grants, including granted primitives, granted tooling capability bundles, selected provider adapters, exclusion reasons, and revocation state
- **SM-004**: The storage model MUST support querying tool grants by `agent_id`, `delegation_id`, and `work_item_id` for audit and debugging
- **SM-005**: The storage model MUST support updating durable-agent capability-profile assignments without changing durable agent identity

### Terminology Lock

- **TL-001**: `routing capability` means the delegation label used by Prime and routing logic to choose what kind of worker is needed
- **TL-002**: `tooling capability bundle` means the least-privilege policy bundle used to derive tool access for a run
- **TL-003**: `provider adapter` means the concrete MCP/HTTP/CLI/SDK implementation selected behind a tooling capability bundle
- **TL-004**: Routing capability names MAY overlap semantically with tooling capability names, but they are different architectural concepts and MUST be stored and resolved separately
- **TL-005**: Provider adapter identifiers MUST NOT be used as delegation routing labels
- **TL-006**: `platform primitive` means the canonical architectural action contract, not necessarily the literal name of the Phase A MCP or HTTP tool that implements it

### Control-Plane Primitive Rules

- **CP-001**: Control-plane primitives are part of the resolved tool grant, not a globally visible always-on surface
- **CP-002**: Runtime configuration MUST expose only the control-plane primitives granted for that run
- **CP-003**: Backend authorization MUST still validate primitive access even when a primitive is present in the runtime configuration
- **CP-004**: Prime-only primitives MUST never appear in non-Prime tool grants
- **CP-005**: Broadly useful non-Prime primitives such as work-item updates or artifact publication MAY be included in many grants, but only through explicit profile resolution

### Key Entities *(include if feature involves data)*

- **Platform Primitive**: A stable ACP-native action contract such as delegation, approvals, work-item updates, or artifact publishing
- **Primitive Mapping**: The translation layer from canonical platform primitive names to concrete MCP/control-plane tool names exposed in Phase A
- **Routing Capability**: The delegation-routing label used to select an eligible worker for a task
- **Capability Bundle**: A policy-level grouping of related permissions such as repo read, verification, or staging deploy
- **Provider Adapter**: A concrete implementation that fulfills one or more capability bundles using MCP, HTTP, CLI, stdio, or SDK transport
- **Capability Profile**: A role- or template-level policy object describing which platform primitives and capability bundles may be granted by default
- **Tool Grant**: The resolved per-run access package that includes granted primitives, granted capability bundles, selected provider adapters, and exclusion reasons
- **Grant Resolution Policy**: The ordered rule set that combines deny rules, task scope, approvals, environment, and adapter health into a final tool grant
- **Adapter Lease**: The credential and runtime lease associated with selected provider adapters for a specific run

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A spawned agent's runtime config contains only the provider adapters and ACP primitives included in its resolved tool grant
- **SC-002**: Durable role capability profiles can be changed without creating new durable agent identities or worktrees
- **SC-003**: A capability bundle can be remapped from one provider adapter to another without requiring changes to agent-facing task prompts or contracts
- **SC-004**: Approval-gated capabilities remain excluded from unapproved runs and appear only in approved runs where policy allows them
- **SC-005**: ACP can explain, for any completed or failed run, which capabilities and provider adapters were granted and why others were excluded
- **SC-006**: Ephemeral templates start from a narrower default grant surface than durable staff roles

## Assumptions

- Builds on the existing ACP control-plane tools, agent `capabilities`, MCP registry tables, and runtime config generation
- Scope model is deny-by-default with explicit grants per role, template, and task
- Agents should prefer platform primitives and capability names over direct references to provider adapter names
- Initial implementation may store parts of the capability-profile model in existing tables and config files before a richer dedicated schema is introduced
- Provider adapter lifecycle management only applies to adapters ACP actually hosts or starts; external services remain externally managed
- Prime remains the orchestrator and policy evaluator, but final per-run grant resolution happens in the harness/runtime path defined by `002`
- Inspired by OpenSwarm's registry concepts, but adapted for ACP's hosted, DB-coordinated, least-privilege model
