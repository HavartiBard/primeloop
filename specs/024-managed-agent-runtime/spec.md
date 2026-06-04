# Feature Specification: Managed-Agent Runtime Alignment

**Feature Branch**: `024-managed-agent-runtime`

**Created**: 2026-06-04

**Status**: Draft

**Input**: User description: "Managed-agent architecture alignment: make agent runtimes decoupled, resumable, and credential-brokered per the Anthropic managed-agents model. Treat the durable event log as the resumable source of truth so harness/backend restarts resume in-flight delegations via wake() instead of failing them; add positional getEvents access for context assembly; implement the credential broker (spec 010) so provider keys and MCP secrets are short-lived, scoped, and never written to the workdir; extend on-demand (cattle) provisioning to durable staff instead of eager boot-time pet processes; consolidate the fragmented session state behind a single replayable session interface."

## Clarifications

### Session 2026-06-04

- Q: Security posture / isolation trust level for agent runtimes? → A: Semi-trusted — agents run the operator's own tasks but can be prompt-injected by untrusted data; baseline isolation is a userspace-kernel sandbox (gVisor-class) plus scoped filesystem and a default-deny egress proxy. Per-task microVMs are not required unless agents later run untrusted/third-party code.
- Q: Readiness budget for on-demand provisioning of an idle durable agent? → A: ≤5s at p95 (≤10s at p99) for a cold first-use start, without maintaining a pre-warmed runtime pool.
- Q: Which in-flight work resumes after a restart, durable vs ephemeral? → A: Durable-staff delegations resume in place from the durable record; ephemeral in-flight delegations are re-dispatched as a fresh ephemeral from their last durable continuation (the torn-down ephemeral runtime is not resumed). Both record a recovery outcome; neither is silently lost.
- Q: Brokered credential lifespan / rotation bound? → A: Durable-agent credentials rotate on a ≤24h TTL, conditional on automatic rotation. Any credential that cannot be automatically rotated — or that remains valid beyond its TTL — MUST be flagged as risky and surfaced to the operator. Ephemeral credentials stay bound to agent lifespan, revoked at teardown.
- Q: Idle threshold before a durable runtime is reclaimed to the cattle pool? → A: 10 minutes with no work; re-provision on next work within the ≤5s/p95 budget.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - In-flight work survives a restart (Priority: P1)

The operator has delegated several tasks to agents and they are actively running.
The backend (or an individual agent runtime) restarts — a deploy, a crash, a host
reboot. Today those in-flight delegations are marked failed and the operator must
notice and re-issue them. After this change, the work resumes automatically from the
durable record where it left off, and anything that genuinely cannot resume produces
a clearly recorded recovery outcome the operator can see — never a silent loss.

**Why this priority**: This is the core reliability promise of the managed-agent
model and the single largest gap today. For an always-on control plane operated by
one person, losing accepted work on a routine restart directly erodes trust and
forces manual babysitting — the exact opposite of the product's purpose.

**Independent Test**: Start two or more delegations, restart the backend mid-flight,
and confirm each delegation either resumes to completion without operator action or
shows an explicit recovery outcome. No delegation is left in a silently failed or
orphaned state.

**Acceptance Scenarios**:

1. **Given** an in-flight delegation, **When** the backend restarts, **Then** the
   delegation resumes from its durable record and completes without the operator
   re-issuing it.
2. **Given** an in-flight delegation whose underlying runtime cannot be resumed,
   **When** the backend restarts, **Then** the delegation is re-dispatched from its
   last durable continuation, and the recovery action is recorded as an observable
   event.
3. **Given** a delegation that has already completed, **When** a duplicate resume is
   triggered during recovery, **Then** no work is repeated and no side effect runs
   twice.

---

### User Story 2 - Secrets are brokered, short-lived, and never on disk (Priority: P2)

When an agent runtime starts, it needs credentials — an LLM provider key, a Gitea
token, an operator-defined named secret. Today some of these are handed to the
runtime as long-lived values and may land in its working directory or config files.
After this change, every secret an agent uses is issued by a broker at start time,
scoped to that agent, valid only for its lifespan, revoked at teardown, and never
written to the worktree, working directory, or any durable config file.

**Why this priority**: Credential sprawl in a shared runtime environment is the
primary security risk for a self-hosted control plane that holds the operator's real
infrastructure access. This realizes the long-standing credential-broker intent
(spec 010, currently a stub) and the constitution's brokered-credential constraint.

**Independent Test**: Provision an agent, then scan its worktree, working directory,
and config files for any secret value — none are present. Tear the agent down and
confirm its credentials are revoked and no longer usable.

**Acceptance Scenarios**:

1. **Given** an agent is being provisioned, **When** it starts, **Then** its secrets
   are present only in process memory/environment for its lifespan and absent from
   every file on disk.
2. **Given** an ephemeral agent finishes, **When** it is torn down, **Then** its
   brokered credentials are revoked synchronously and further use is rejected.
3. **Given** a durable agent whose credential must rotate, **When** rotation occurs,
   **Then** the agent continues running uninterrupted with the new credential.

---

### User Story 3 - Durable agents are provisioned on demand, not all at boot (Priority: P3)

Today every non-ephemeral ("durable staff") agent is spun up at startup and kept
running, consuming compute whether or not it has work — these are hand-tended
"pets." After this change, a durable agent's runtime is provisioned when work is
first routed to it and reclaimed when idle, while its identity, records, and history
persist unchanged. The operator sees the same roster of agents; the difference is
that idle agents cost nothing to keep around.

**Why this priority**: Eager boot-time processes are the clearest "pets, not cattle"
violation and the main source of idle resource cost and restart fragility. It is
lower priority than P1/P2 because it is an efficiency and robustness improvement
rather than a correctness or security fix.

**Independent Test**: With no work routed, confirm durable agent runtimes are not
running and consume no compute. Route work to a previously idle durable agent and
confirm it provisions, accepts the work within the readiness budget, and its records
are continuous with its prior history.

**Acceptance Scenarios**:

1. **Given** a freshly booted system with no routed work, **When** the operator
   inspects running runtimes, **Then** no durable agent runtime is running.
2. **Given** an idle durable agent, **When** work is routed to it, **Then** its
   runtime provisions and begins the work within the readiness budget.
3. **Given** a durable agent reclaimed after idle, **When** it is re-provisioned,
   **Then** its identity and durable records are unchanged and no work is lost.

---

### User Story 4 - One coherent, replayable session timeline (Priority: P3)

Session state today is spread across multiple stores (events, messages, delegation
traces, the work queue, and checkpoints), so there is no single place to reconstruct
"what happened" in a session or to feed a resuming runtime. After this change, the
operator (and Prime) can view any session as one coherent, append-only timeline and
read just the slice they need — the most recent events, or a specific range — rather
than the whole history. This unified record is also the substrate that makes
resumption (US1) reliable.

**Why this priority**: It is foundational to US1 and improves auditability, but on
its own it is an internal consolidation, so it ranks alongside US3 rather than above
the reliability and security stories it supports.

**Independent Test**: Open any active or completed session and reconstruct its full
ordered timeline from one interface; request a bounded slice (e.g., the last N
events) and confirm it returns without loading the entire history.

**Acceptance Scenarios**:

1. **Given** a session with many events, **When** the operator requests its timeline,
   **Then** a single ordered, replayable record is returned across all formerly
   separate stores.
2. **Given** a long session, **When** a bounded range of events is requested, **Then**
   only that slice is returned without materializing the full history.

---

### User Story 5 - A subverted agent cannot escape or exfiltrate (Priority: P2)

Agents constantly read untrusted material — repository files, tool outputs, web and
API responses — any of which can carry a prompt injection. Even if an agent is fully
subverted, it must not be able to modify files outside its workspace, read another
agent's workspace or any secret, or send data to a destination that was never
approved. The runtime confines each agent on both the filesystem and the network so
the blast radius of any compromise is contained.

**Why this priority**: It is the necessary partner to US2. Brokering secrets is only
meaningful if a subverted agent also cannot exfiltrate them through an open network
path or reach out-of-scope files. Together they bound the blast radius of prompt
injection — the dominant agent threat — which is why this ranks at P2 alongside the
credential broker rather than below the efficiency stories.

**Independent Test**: From inside an agent runtime, attempt to (a) write a file
outside the working directory, (b) read a known secret path or another agent's
workspace, and (c) open a network connection to a host not on the allowlist — each
must fail and be recorded; an allowlisted operation must succeed.

**Acceptance Scenarios**:

1. **Given** an agent runtime, **When** it attempts to modify a file outside its
   working directory, **Then** the write is denied.
2. **Given** an agent runtime, **When** it attempts to connect to a host not on its
   egress allowlist, **Then** the connection is blocked and recorded as an event.
3. **Given** an agent runtime, **When** it attempts to read brokered secrets or
   another agent's workspace, **Then** access is denied.

---

### Edge Cases

- A restart occurs *during* recovery itself — recovery MUST be idempotent so a second
  pass neither double-resumes nor double-fails a delegation.
- A brokered credential expires while an agent is still mid-task — the agent MUST
  obtain a refreshed credential (rotation) rather than failing the task outright.
- An upstream credential provider that cannot issue scoped tokens (e.g., a shared LLM
  provider key) — the agent calls a control-plane proxy with a scoped token instead of
  ever receiving the raw key (FR-008).
- Work is routed to a durable agent while its runtime is still provisioning — the
  work MUST queue against that agent rather than being dropped or double-provisioning.
- A session's durable record is corrupt or partially written — resume MUST fail safe
  to a recorded recovery outcome rather than replaying an inconsistent state.
- An agent legitimately needs a host not yet on its egress allowlist — the request
  MUST be denied by default and surfaced for an explicit allowlist decision, never
  silently permitted.
- An agent attempts to reach the upstream provider directly instead of via the
  control-plane proxy — the direct egress MUST be blocked, leaving the proxy as the
  only working path.

## Constitution Alignment *(mandatory)*

- **Code Quality Plan**: The change is delivered behind the existing harness/adapter
  and session interfaces; new behavior (resume, broker, on-demand provisioning) is
  introduced as cohesive, separately testable units with explicit failure paths.
  Recovery, brokering, and provisioning logic each carry verification proportional to
  their operational risk.
- **YAGNI Check**: New abstractions are limited to those with an active need: a
  unified session interface (enables resumption), a credential broker (realizes
  spec 010), and an on-demand runtime lease. No speculative multi-tenant, multi-host,
  or pluggable-backend flexibility is introduced. The replayable session interface
  consolidates existing stores rather than adding a parallel one.
- **Reliability & Operations**: Directly a reliability and security feature. Every
  resume, recovery outcome, credential issue/rotate/revoke, provisioning transition,
  and denied isolation attempt emits an observable event. Failure modes (unresumable
  session, expired credential, provisioning timeout, blocked egress) degrade to
  recorded outcomes, never silent loss. Rollback is feature-flagged: the prior "fail
  and re-queue" and "eager boot" behaviors remain available as fallbacks until the new
  paths are proven.
- **UX Consistency**: The operator's mental model is unchanged — same agent roster,
  same delegations. The visible improvement is that delegations survive restarts and
  recovery outcomes are surfaced with existing status terminology and states
  (active / resumed / recovered / failed). No new primary workflow is introduced.
- **Design Consistency**: Recovery and provisioning states reuse existing agent and
  delegation status indicators and the existing event/timeline surfaces; no new UI
  pattern is required beyond labeling resumed/recovered states within current
  components.
- **Primeloop Architecture Constraints**: Reinforces them. Durable records remain the
  source of truth and become the *resumable* source of truth; Prime stays the sole
  steering interface; per-agent isolation is strengthened, not changed; single-tenant
  scope is unchanged. Implements Core Principle VI (decoupled, replaceable runtimes)
  and the resumable-session-log, brokered-credential, and two-dimension
  runtime-isolation (scoped filesystem + default-deny egress, blast-radius
  containment) constraints.

## Requirements *(mandatory)*

### Functional Requirements

**Resumable sessions (US1)**

- **FR-001**: The system MUST treat the durable session log as the authoritative,
  append-only record of every agent and delegation session, sufficient to reconstruct
  that session's state independent of any in-memory runtime state.
- **FR-002**: On a backend or agent-runtime restart, the system MUST recover each
  in-flight delegation from its durable record rather than marking it failed, by tier:
  durable-staff delegations MUST resume in place from the durable record; ephemeral
  delegations MUST be re-dispatched as a fresh ephemeral runtime from their last
  durable continuation (the torn-down ephemeral runtime is not resumed). Both paths
  MUST record a recovery outcome; neither MUST be silently lost.
- **FR-003**: When direct in-place resumption of a durable runtime is not possible,
  the system MUST fall back to re-dispatching the delegation from its last durable
  continuation/checkpoint and record that recovery action (the same mechanism
  ephemeral recovery uses).
- **FR-004**: Resumption and recovery MUST be idempotent — a duplicate or repeated
  recovery pass MUST NOT re-execute side effects, duplicate work, or double-count
  results.

**Unified, replayable session interface (US4)**

- **FR-005**: The system MUST present session state that is currently fragmented
  across separate stores (events, messages, delegation traces, work queue,
  checkpoints) as a single coherent, ordered, replayable timeline per session.
- **FR-006**: The system MUST provide positional/bounded access to a session's events
  (e.g., a range or the most recent N) for context assembly and inspection without
  materializing the session's entire history.

**Credential broker (US2)**

- **FR-007**: The system MUST issue every agent secret through a broker as a
  short-lived, per-agent, scoped credential at process start, and MUST revoke it at
  teardown (synchronously for ephemeral agents).
- **FR-008**: For upstream credentials that support scoping (e.g., Gitea tokens,
  operator-defined named secrets), the broker MUST issue derived/scoped tokens rather
  than copies of master secrets. For upstream credentials that cannot be scoped (e.g.,
  a shared LLM provider key), the system MUST route the agent's calls through a
  control-plane proxy so the raw key never reaches the agent runtime or its workdir;
  the agent is granted only a scoped, short-lived token authorizing it to call the
  proxy, not the upstream secret itself.
- **FR-009**: Secret values MUST NOT be written to agent worktrees, working
  directories, or durable config files at any point; they exist only in process
  memory/environment for the agent's lifespan.
- **FR-010**: The broker MUST automatically rotate durable-agent credentials on a TTL
  of ≤24h without restarting the agent. Any credential that cannot be automatically
  rotated, or that remains valid beyond its TTL, MUST be flagged as risky and surfaced
  to the operator as an observable event rather than silently tolerated.
- **FR-011**: The broker MUST support at minimum LLM provider API keys, Gitea tokens,
  and operator-defined named secrets.

**On-demand (cattle) provisioning (US3)**

- **FR-012**: The system MUST provision durable-staff agent runtimes on demand when
  work is first routed to them, rather than eagerly at boot, while preserving each
  agent's durable identity, records, and history.
- **FR-013**: The system MUST reclaim a durable runtime after 10 minutes with no work
  such that the idle agent consumes no runtime compute, and MUST be able to
  re-provision it on the next routed work (within the FR-014 readiness budget) without
  losing work or changing its identity.
- **FR-014**: First-use provisioning MUST make a runtime ready within the readiness
  budget of ≤5s at p95 (≤10s at p99) measured from work being routed to the agent
  accepting it, and work routed to a still-provisioning agent MUST queue rather than
  be dropped or trigger duplicate provisioning. Meeting this budget MUST NOT rely on a
  pre-warmed runtime pool.

**Runtime isolation & containment (US5)**

- **FR-018**: Each agent runtime MUST be confined to a scoped filesystem — read and
  write limited to its own working directory; reading or modifying paths outside its
  assigned scope, including other agents' workspaces and any credential path, MUST be
  denied.
- **FR-019**: Each agent runtime MUST enforce default-deny network egress; outbound
  connections MUST be permitted only to an explicit per-agent allowlist, enforced by a
  control point the agent cannot bypass.
- **FR-020**: The control-plane proxy (FR-008) MUST be the only outbound path for
  brokered upstream calls, MUST itself enforce the egress allowlist, and MUST record
  the requests it brokers.
- **FR-021**: Isolation MUST hold under the assumption that the agent is subverted by
  untrusted input (file contents, tool outputs, external responses); any attempt to
  read out-of-scope resources or reach a non-allowlisted host MUST fail and be
  recorded as an observable event.
- **FR-022**: Agent runtimes are treated as semi-trusted (they run the operator's own
  tasks but are exposed to prompt injection from untrusted data). The baseline
  isolation MUST therefore be a userspace-kernel sandbox (gVisor-class) combined with
  the scoped filesystem (FR-018) and default-deny egress proxy (FR-019); per-task
  microVM isolation is NOT required at this trust level. If agents later execute
  untrusted or third-party code, the trust level MUST be re-evaluated and a stronger
  boundary (e.g., microVM) adopted.

**Cross-cutting**

- **FR-015**: Every resume, recovery outcome, credential issuance/rotation/revocation,
  risky-credential flag, provisioning transition, and denied isolation attempt
  (out-of-scope file or non-allowlisted host) MUST be recorded as an observable event.
- **FR-016**: The change MUST preserve existing delegation, routing, and approval
  behavior; agents that do not support native session reload MUST still benefit from
  checkpoint-based recovery (FR-003).
- **FR-017**: The prior behaviors (fail-and-requeue on restart; eager boot-time
  provisioning) MUST remain available as a fallback/rollback path until the new paths
  are validated in operation.

### Key Entities *(include if feature involves data)*

- **Session**: The durable, append-only record of one agent or delegation
  interaction; the authoritative source from which state is reconstructed or resumed.
  Relates to a delegation and/or thread and to the agent that owns it.
- **Session Event**: A single ordered, positionally addressable entry in a session's
  timeline (decisions, messages, tool activity, traces, lifecycle transitions).
- **Continuation / Checkpoint**: A durable snapshot of a session's resumable point,
  used to re-dispatch work when native runtime resumption is unavailable.
- **Brokered Credential**: A short-lived, scoped secret issued to an agent for its
  lifespan, with issuance, rotation, and revocation lifecycle; never persisted to disk.
- **Runtime Lease**: The on-demand provisioning record binding a durable agent's
  identity to a currently-running (or reclaimable) runtime instance.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After an unplanned restart with multiple in-flight delegations, at
  least 99% resume and complete with no operator intervention, and 100% of the
  remainder produce a recorded recovery outcome — zero silently lost or orphaned
  delegations.
- **SC-002**: A scan of every agent worktree, working directory, and config file
  finds zero secret values present, before, during, and after agent runtime.
- **SC-003**: Durable-agent credentials are automatically rotated within a ≤24h TTL,
  and ephemeral-agent credentials are unusable within seconds of teardown; any
  credential that cannot be auto-rotated or outlives its TTL is flagged as risky to
  the operator (none pass silently).
- **SC-004**: A durable agent with no work for 10 minutes is reclaimed and consumes
  zero idle compute; a previously idle durable agent becomes ready for first-use work
  within ≤5s at p95 (≤10s at p99).
- **SC-005**: The operator can reconstruct and replay any session's complete ordered
  timeline from a single interface, and can retrieve a bounded slice of it without
  loading the full history.
- **SC-006**: No regression in existing delegation success rate or operator workflow
  attributable to this change.
- **SC-007**: From inside an agent runtime, attempts to write outside the working
  directory, read secrets or another agent's workspace, or connect to a
  non-allowlisted host all fail and are recorded, while allowlisted operations
  succeed — demonstrated by a repeatable isolation test.

## Assumptions

- Recovery strategy is two-tier by default: prefer native runtime session reload
  where the runtime supports it (e.g., an ACP `loadSession` capability), and fall
  back to checkpoint-based re-dispatch otherwise. Both paths record a recovery
  outcome.
- The unified session interface consolidates and exposes the *existing* durable
  stores rather than introducing a separate new persistence backend; the relational
  database remains the store of record.
- Master secrets continue to be stored encrypted using the existing
  `SECRET_ENCRYPTION_KEY` pattern; the broker layers issuance/scoping/revocation on
  top of that store.
- The agent roster, Prime steering model, per-agent isolation, and single-tenant
  scope are unchanged; this feature changes *how* runtimes are managed, not *what*
  the operator controls.
- The on-demand provisioning readiness budget is ≤5s at p95 (≤10s at p99) for a cold
  first-use start, to be met without a pre-warmed runtime pool (see Clarifications).
- This feature supersedes the stubbed spec 010 (credential broker) by carrying its
  intent forward; spec 010's assumptions about scoped tokens and synchronous
  revocation are inherited here.
- Un-scopable upstream secrets (notably shared LLM provider keys) are fronted by a
  control-plane proxy: agents receive a scoped, short-lived token to call the proxy,
  and the raw upstream secret never leaves the control plane. This is the larger-scope
  but strongest-boundary option and is an accepted cost of this feature.
- Today's isolation is a git worktree plus a bare subprocess, with no kernel-level
  sandbox and no network egress allowlist. Reaching FR-018–FR-021 requires adding a
  userspace-kernel sandbox (gVisor-class) and an egress control point/proxy — the
  agreed semi-trusted baseline (see Clarifications). Filesystem and network
  containment are treated as jointly mandatory — neither alone is sufficient.
- Per-agent egress allowlists default to deny-all and are derived from the agent's
  declared capabilities and assigned tools; new destinations require an explicit
  allowlist decision rather than silent permitting.
- Speculative extensibility (multi-tenant, multi-host scheduling, pluggable session
  backends) is explicitly out of scope.
