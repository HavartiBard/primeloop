# Research: Agentic Control Plane

## Codebase findings

### Decision: Bootstrap from the existing Prime runtime instead of inventing a new orchestration core
- **Decision**: Use the current backend Prime runtime as the Phase A foundation:
  `backend/src/prime-agent/{service,event-loop,queue,session,actions,llm-router}.ts`,
  the routing layer under `backend/src/routing/`, the fleet executor under
  `backend/src/fleet-executor/`, and the control-plane surfaces under
  `backend/src/routes/{prime-agent,control-plane,approvals}.ts` plus `backend/src/ws/`.
- **Rationale**: The repository already has a native Prime backend service, queue,
  event loop, routing, executor harnesses, and tests. This is the shortest path to
  a real Prime bootstrap and matches repository instructions that Prime is a native
  backend service rather than an `agents` table row.
- **Alternatives considered**:
  - Rebuild Prime as a new supervisor service from scratch — rejected because it
    duplicates existing queue, routing, and runtime plumbing.
  - Treat Prime as just another durable agent row — rejected because repository
    instructions explicitly forbid the older Prime-as-worker design.

### Decision: Treat existing specs 003, 013, and 015 as the backbone for staffing, learning, and runtime truth
- **Decision**: Use the already-defined roadmap pieces as the supporting skeleton:
  durable staff bootstrap (`003`), grading/self-improvement (`013`), and runtime-
  truth routing (`015`).
- **Rationale**: These specs already isolate the three highest-risk platform needs:
  getting durable staff online, ensuring Prime routes only to executable targets,
  and turning completed work into better future behavior.
- **Alternatives considered**:
  - Fold all concerns into one monolithic first implementation — rejected because
    it weakens reviewability and increases rollout risk.

## Similar tool research

### Decision: Learn UI orchestration from OpenSwarm, but do not copy its operator model
- **Decision**: Borrow the idea of a unified mission-control surface for parallel
  agents, approvals, live status, cost awareness, and worktree visibility.
- **Rationale**: OpenSwarm emphasizes one-screen supervision, unified approvals,
  persistent session history, git worktree isolation, and visual awareness of many
  concurrent agents. Those patterns fit ACP's control-plane goals.
- **Alternatives considered**:
  - Copy OpenSwarm's many-agent-first operator model — rejected because ACP's core
    promise is Prime as the sole steering interface, not direct manual management of
    a visible swarm.
  - Ignore orchestration UI lessons entirely — rejected because the operator still
    needs awareness, progress, and approval ergonomics.
- **Relevant takeaway**: ACP should keep the visibility strengths of a mission
  control center while routing actions through Prime instead of exposing every
  specialist as a first-class steering object.

### Decision: Learn memory, skills, and long-running operability from Hermes Agent
- **Decision**: Borrow Hermes-style strengths around persistent memory, skills,
  health/doctor workflows, setup ergonomics, and long-running gateway operation.
- **Rationale**: Hermes highlights persistent memory, skills, MCP integration,
  messaging gateways, scheduling, setup, and diagnostics. These are useful patterns
  for making Prime reliable and maintainable over time.
- **Alternatives considered**:
  - Copy Hermes as a single generalist runtime for everything — rejected because ACP
    needs a Prime-led team model with durable and ephemeral staff.
  - Delay diagnostic and operator tooling — rejected because SRE maintainability is
    part of the feature request.
- **Relevant takeaway**: ACP should treat setup, diagnosis, and operational health
  as first-class product surfaces, not only backend concerns.

### Decision: Learn isolated agent scoping and gateway routing from OpenClaw
- **Decision**: Borrow OpenClaw's model of isolated per-agent scope: separate
  workspaces, state directories, sessions, and gateway routing to the right agent.
- **Rationale**: OpenClaw's strongest relevant idea is that each agent is a fully
  scoped unit with its own workspace, state, and session history. That aligns well
  with ACP's constitutional requirement for per-agent isolation.
- **Alternatives considered**:
  - Use shared mutable state for all specialists — rejected because it undermines
    isolation, traceability, and recovery.
  - Let gateway bindings become the steering model — rejected because ACP requires
    Prime to remain the sole user-facing entry point.
- **Relevant takeaway**: Keep per-agent runtime separation strict, but hide most of
  that complexity behind Prime's operator experience.

### Decision: Learn lightweight handoff boundaries from OpenAI Swarm, not its production posture
- **Decision**: Use OpenAI Swarm as a conceptual reminder to keep initial handoff
  contracts lightweight and deterministic.
- **Rationale**: Swarm's educational model centers on simple agent handoffs,
  context variables, and bounded turns. That is a good design pressure for Phase A.
- **Alternatives considered**:
  - Adopt Swarm as a production architecture template — rejected because even its
  own documentation positions it as educational and superseded for production use.
- **Relevant takeaway**: Initial Prime bootstrap should favor a small number of
  explicit routing outcomes and simple work-intent contracts over prompt-heavy,
  free-form delegation.

## Path to an initial bootstrapped Prime agent

### Decision: Deliver Prime bootstrap in four thin slices
- **Decision**: Sequence the bootstrap as:
  1. runtime truth + goal intake,
  2. durable staff bootstrap,
  3. delegated work visibility + approvals,
  4. self-healing and self-improvement loop.
- **Rationale**: This follows the existing codebase and spec inventory, reduces
  risk, and keeps Prime usable even before the full learning flywheel is complete.
- **Alternatives considered**:
  - Start with full autonomous multi-agent orchestration — rejected because routing,
    approvals, and runtime truth must exist first.

### Phase A: Prime runtime truth and operator goal loop
- **Decision**: First make Prime trustworthy as a backend singleton that accepts
  goals, records durable state, and routes only to executable targets.
- **Rationale**: The repository already contains Prime queue/event-loop/runtime code,
  and spec `015-prime-routing-runtime-truth` defines the right contract boundary.
- **Concrete scope**:
  - goal intake and durable goal record
  - Prime-owned goal status and summary
  - routing outcomes based on executable runtime truth
  - no fake delegation to non-runnable durable staff
  - operator-visible blockers and approval pauses

### Phase B: Minimal durable team that can keep the platform alive
- **Decision**: Bootstrap only two durable operational roles at first:
  **SRE/DevOps** (combined) and **Architect**.
- **Rationale**: In a single-tenant system, SRE and DevOps overlap heavily. One
  combined operator-maintenance role plus one design/governance role is enough for
  initial platform survival. This also matches the constitution's YAGNI emphasis.
- **Alternatives considered**:
  - Bootstrap three separate durable roles immediately (Architect, SRE, DevOps) —
    deferred because it adds coordination overhead before runtime truth is stable.
  - No durable staff at all — rejected because Prime needs at least one always-on
    maintenance role for incidents, deploys, and runtime health.
- **Concrete role split**:
  - **Prime**: user-facing orchestration, goal decomposition, approvals, narration
  - **SRE/DevOps durable role**: health checks, incidents, deploys, queue/runtime
    recovery, credential and environment integrity, routine operations
  - **Architect durable role**: artifact quality, playbooks, template updates,
    grading review, cross-cutting consistency

### Phase C: Ephemeral specialist execution
- **Decision**: Keep homelab, development, and personal-assistant work primarily as
  spawnable or dispatchable specialist execution paths behind Prime, not as manually
  driven durable personas.
- **Rationale**: Specialists should be cheap to invoke, disposable, and tightly
  scoped. This keeps the durable team small while allowing broad task coverage.
- **Alternatives considered**:
  - Make every domain specialist durable from day one — rejected because it expands
    maintenance burden before execution quality is proven.

### Phase D: Close the self-healing and self-improvement loop
- **Decision**: Add explicit recovery events plus post-run grading and learning
  records as first-class durable artifacts.
- **Rationale**: Recovery without learning repeats failures; learning without
  recovery helps only future runs. ACP needs both.
- **Concrete loop**:
  1. Prime or runtime detects a blocked, failed, or stalled work item.
  2. A recovery event records the condition and chooses retry, reroute, escalate,
     request approval, or stop.
  3. The SRE/DevOps durable role owns unresolved runtime/platform incidents.
  4. The Architect durable role reviews repeated failure patterns and template or
     playbook changes.
  5. Approved improvements update prompts, routing policy, templates, runbooks, or
     durable-role procedures.

## Minimal devops/sre team recommendation

### Decision: Start with one durable SRE/DevOps role plus operator override
- **Decision**: The minimum viable operational team is:
  - Prime
  - one combined durable **SRE/DevOps** role
  - one durable **Architect** role
  - the human operator for approvals and exceptional decisions
- **Rationale**: This is the smallest team that can maintain uptime, recover from
  runtime issues, manage deploy/config drift, and improve system behavior without
  overfitting roles too early.
- **Alternatives considered**:
  - Prime only — rejected because self-healing needs a persistent maintenance owner.
  - Full separate SRE and DevOps from day one — deferred until workload proves the
    split is worth the complexity.

## Recommended first implementation path

### Decision: Implement in this order
1. spec `015` runtime-truth routing
2. spec `016` goal/work-item control plane
3. spec `003` durable staff bootstrap with combined SRE/DevOps + Architect
4. approvals + control-plane visibility
5. spec `013` grading/self-improvement loop

- **Rationale**: This order turns Prime into a truthful orchestrator first, then a
  usable operator-facing product, then a maintainable platform, then a learning
  system.
- **Alternatives considered**:
  - Build the learning loop before durable staff and routing truth — rejected
    because it would optimize a misleading or non-executable system.
